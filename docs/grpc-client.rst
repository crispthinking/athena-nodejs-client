Athena gRPC Client
==================

This document describes the gRPC client implementation for the Athena classifier service.

Client Interface
----------------

IClassifierServiceClient
~~~~~~~~~~~~~~~~~~~~~~~~

Interface defining all available operations for the classifier service.

* ``classify()`` - Bidirectional streaming for image classification
* ``listDeployments()`` - Unary call to list active deployments

Client Implementation
---------------------

ClassifierServiceClient
~~~~~~~~~~~~~~~~~~~~~~~

Concrete implementation extending ``grpc.Client``.

Constructor
^^^^^^^^^^^

``ClassifierServiceClient(address, credentials, options?, binaryOptions?)``

* ``address: string`` - Server address (e.g., "localhost:50051")
* ``credentials: grpc.ChannelCredentials`` - Authentication credentials
* ``options: grpc.ClientOptions`` - Optional client configuration
* ``binaryOptions: Partial<BinaryReadOptions & BinaryWriteOptions>`` - Optional protobuf options

Methods
-------

classify()
~~~~~~~~~~

Performs image classification using bidirectional streaming.

**Signatures:**

* ``classify(metadata: grpc.Metadata, options?: grpc.CallOptions): grpc.ClientDuplexStream<ClassifyRequest, ClassifyResponse>``
* ``classify(options?: grpc.CallOptions): grpc.ClientDuplexStream<ClassifyRequest, ClassifyResponse>``

**Returns:** ``grpc.ClientDuplexStream<ClassifyRequest, ClassifyResponse>``

**Features:**

* Bidirectional streaming for real-time classification
* Deployment-based context sharing
* Multiple affiliates can join the same deployment
* Supports batch processing of multiple images per request

listDeployments()
~~~~~~~~~~~~~~~~~

Retrieves a list of all active deployment IDs.

**Signatures:**

* ``listDeployments(input: Empty, metadata: grpc.Metadata, options: grpc.CallOptions, callback): grpc.ClientUnaryCall``
* ``listDeployments(input: Empty, metadata: grpc.Metadata, callback): grpc.ClientUnaryCall``
* ``listDeployments(input: Empty, options: grpc.CallOptions, callback): grpc.ClientUnaryCall``
* ``listDeployments(input: Empty, callback): grpc.ClientUnaryCall``

**Parameters:**

* ``input: Empty`` - Empty message (no input parameters required)
* ``metadata: grpc.Metadata`` - Optional gRPC metadata
* ``options: grpc.CallOptions`` - Optional call options
* ``callback: (err: grpc.ServiceError | null, value?: ListDeploymentsResponse) => void`` - Response callback

**Returns:** ``grpc.ClientUnaryCall``
