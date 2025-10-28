import { onCall, HttpsError } from 'firebase-functions/v2/https';
import axios from 'axios';

export const geocodeAddress = onCall(
  {
    region: 'australia-southeast1',
    secrets: ['GOOGLE_MAPS_API_KEY'],
    cors: true,
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be authenticated');
    }

    const { address } = request.data;

    if (!address || typeof address !== 'string') {
      throw new HttpsError('invalid-argument', 'Address is required');
    }

    try {
      const apiKey = process.env.GOOGLE_MAPS_API_KEY;
      
      if (!apiKey) {
        throw new HttpsError('failed-precondition', 'Google Maps API key not configured');
      }

      const response = await axios.get('https://maps.googleapis.com/maps/api/geocode/json', {
        params: { address, key: apiKey }
      });

      if (response.data.status === 'ZERO_RESULTS') {
        throw new HttpsError('not-found', 'No results found for this address.');
      }

      if (response.data.status !== 'OK') {
        throw new HttpsError('not-found', `Address lookup failed: ${response.data.status}`);
      }

      const result = response.data.results[0];
      
      return {
        latitude: result.geometry.location.lat,
        longitude: result.geometry.location.lng,
        formatted_address: result.formatted_address
      };
    } catch (error: any) {
      if (error instanceof HttpsError) {
        throw error;
      }
      throw new HttpsError('internal', 'Failed to geocode address');
    }
  }
);