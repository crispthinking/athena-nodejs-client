Hashing Utilities
=================

Provides functions to compute MD5 and SHA1 hashes from a readable stream and resize image data. Supports optional Brotli compression.

**Main features:**
- Computes MD5 and SHA1 hashes
- Resizes images to 448x448 pixels
- Supports Brotli compression


.. js:autofunction:: computeHashesFromStream

**Usage Example:**
.. code-block:: typescript

   import { computeHashesFromStream } from './hashing';
   const result = await computeHashesFromStream(stream);
   // result.md5, result.sha1, result.data

**Parameters:**
- `stream`: Node.js readable stream
- `encoding`: Encoding type for the image data (default: UNCOMPRESSED)

**Returns:**
- Object containing MD5 hash, SHA1 hash, and resized image buffer


