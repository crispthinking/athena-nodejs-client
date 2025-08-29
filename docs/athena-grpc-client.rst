Athena gRPC Client
==================

Provides the gRPC client interface for the Athena Classifier service. Supports image classification and deployment management via streaming and RPC calls.

**Main features:**
- Classify images in real-time using bidirectional streaming
- List active deployments
- Integrates with Athena protobuf types

**Example Interfaces:**
- `IClassifierServiceClient`: Main client interface
- `ClassifierServiceClient`: Implementation of the client

**Usage Example:**
.. code-block:: typescript

   const client = new ClassifierServiceClient(...);
   client.classify(...);
