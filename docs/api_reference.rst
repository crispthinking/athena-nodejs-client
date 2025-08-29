
API Reference
=============

Overview
--------
Athena NodeJS SDK provides real-time image classification for CSAM detection using gRPC. It supports session-based deployments, multi-affiliate collaboration, and a wide range of image formats and error handling features.

Main Classes
------------

- **ClassifierSdk**: Main entry point for interacting with the Athena service. Handles authentication, deployment management, and image classification.
- **ClassifierServiceClient**: Low-level gRPC client for direct service calls.
- **ClassifyImageOptions**: Options for sending image classification requests.

Usage Example
-------------

.. code-block:: javascript

   import { ClassifierSdk } from 'athena-nodejs-sdk';

   const sdk = new ClassifierSdk({
     deploymentId: 'your-deployment-id',
     affiliate: 'your-affiliate',
     authentication: {
       issuerUrl: 'https://issuer.example.com',
       clientId: 'your-client-id',
       clientSecret: 'your-client-secret',
       scope: 'manage:classify'
     }
   });

   await sdk.open();
   const deployments = await sdk.listDeployments();
   // Send image for classification
   await sdk.sendClassifyRequest({
     imageStream: fs.createReadStream('image.jpg'),
     format: ImageFormats.JPEG,
   });

   sdk.on('data', (response) => {
     console.log('Classification result:', response);
   });

   sdk.on('error', (err) => {
     console.error('Error:', err);
   });

   sdk.on('close', () => {
     console.log('Connection closed');
   });

API Classes
-----------

.. js:autoclass:: ClassifierSdk
   :members:

.. js:autoclass:: ClassifierServiceClient
   :members:

.. js:autoclass:: ClassifyImageOptions
    :members:
