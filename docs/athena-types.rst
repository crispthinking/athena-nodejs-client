Athena Generated Types
======================

This document describes the TypeScript types and interfaces generated from the
Athena protobuf definitions.

See the :doc:`athena_protobufs:index` for more information about the protobuf
definitions.


Request Types
-------------

ClassifyRequest
~~~~~~~~~~~~~~~

Request message for image classification.

* ``deploymentId: string`` - Deployment identifier for routing responses
* ``inputs: ClassificationInput[]`` - Array of images to classify

ClassificationInput
~~~~~~~~~~~~~~~~~~~

Single image classification input.

* ``affiliate: string`` - Source system identifier
* ``correlationId: string`` - Unique ID for matching responses
* ``encoding: RequestEncoding`` - Data compression format
* ``data: Uint8Array`` - Raw image bytes
* ``format: ImageFormat`` - Image file format
* ``hashes: ImageHash[]`` - Image data hashes

Response Types
--------------

ClassifyResponse
~~~~~~~~~~~~~~~~

Response containing classification results.

* ``globalError?: ClassificationError`` - Error affecting entire request
* ``outputs: ClassificationOutput[]`` - Individual image results

ClassificationOutput
~~~~~~~~~~~~~~~~~~~~

Result for a single image.

* ``correlationId: string`` - Matches input correlation ID
* ``classifications: Classification[]`` - Detected classifications
* ``error?: ClassificationError`` - Image-specific error

Classification
~~~~~~~~~~~~~~

Single classification result.

* ``label: string`` - Classification label
* ``weight: number`` - Confidence score (0.0 - 1.0)

ClassificationError
~~~~~~~~~~~~~~~~~~~

Error information.

* ``code: ErrorCode`` - Error type
* ``message: string`` - Error description
* ``details: string`` - Additional error context

Deployment Types
----------------

ListDeploymentsResponse
~~~~~~~~~~~~~~~~~~~~~~~

Response listing active deployments.

* ``deployments: Deployment[]`` - Array of deployment info

Deployment
~~~~~~~~~~

Single deployment information.

* ``deploymentId: string`` - Deployment identifier
* ``backlog: number`` - Number of queued responses

Utility Types
-------------

ImageHash
~~~~~~~~~

Hash of image data.

* ``value: string`` - Hash value
* ``type: HashType`` - Hash algorithm type

Enums
-----

ErrorCode
~~~~~~~~~

* ``UNSPECIFIED = 0`` - Unknown error
* ``IMAGE_TOO_LARGE = 2`` - Image exceeds size limits
* ``MODEL_ERROR = 3`` - Classifier internal error
* ``AFFILIATE_NOT_PERMITTED = 4`` - Access denied for affiliate

RequestEncoding
~~~~~~~~~~~~~~~

* ``UNSPECIFIED = 0`` - Default (uncompressed)
* ``UNCOMPRESSED = 1`` - Raw image data
* ``BROTLI = 2`` - Brotli compressed data

ImageFormat
~~~~~~~~~~~

* ``UNSPECIFIED = 0`` - Unknown format
* ``GIF = 1`` - GIF format
* ``JPEG = 2`` - JPEG format (.jpeg, .jpg, .jpe)
* ``BMP = 3`` - BMP format
* ``DIB = 4`` - DIB format
* ``PNG = 5`` - PNG format
* ``WEBP = 6`` - WebP format
* ``PBM = 7`` - PBM format
* ``PGM = 8`` - PGM format
* ``PPM = 9`` - PPM format
* ``PXM = 10`` - PXM format
* ``PNM = 11`` - PNM format
* ``PFM = 12`` - PFM format
* ``SR = 13`` - SR format
* ``RAS = 14`` - RAS format
* ``TIFF = 15`` - TIFF format (.tiff, .tif)
* ``HDR = 16`` - HDR format
* ``PIC = 17`` - PIC format
* ``RAW_UINT8 = 18`` - Raw 8-bit RGB data

HashType
~~~~~~~~

* ``UNKNOWN = 0`` - Unknown hash type
* ``MD5 = 1`` - MD5 hash
* ``SHA1 = 2`` - SHA1 hash
