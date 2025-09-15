Authentication Manager
======================

Manages OAuth authentication and token refresh for the Athena gRPC client.  Handles acquiring and refreshing access tokens using the OAuth client credentials flow.

**Main features:**
- Supports OAuth client credentials grant
- Handles token refresh and decoding
- Integrates with Athena gRPC client

**Usage Example:**

.. code-block:: typescript

   import { AuthenticationManager } from '@crispthinking/athena-classifier-sdk';
   const auth = new AuthenticationManager({
       clientId: 'your-client-id',
       clientSecret: 'your-client-secret',
       issuerUrl: 'https://issuer.example.com',
       scope: 'manage:classify',
   });

**Options:**

* `clientId`: OAuth client ID
* `clientSecret`: OAuth client secret
* `issuerUrl`: URL of the OAuth issuer
* `autoRefresh`: Whether to automatically refresh the access token
* `scope`: OAuth scope to request

.. ts:autoclass:: AuthenticationManager
   :members:
