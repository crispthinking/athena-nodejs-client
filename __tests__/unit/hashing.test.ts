import { describe, it,} from 'vitest';
import { computeHashesFromStream, HashType, ImageFormat, RequestEncoding } from '../../src';
import fs from 'fs';

describe('hashing', () => {
  describe('computeHashesFromStream', () =>  {
    it('should compute MD5 and SHA1 hashes for a valid image', async ({expect}) => {
      // Test implementation here
      // Test implementation here
      const imagePath = __dirname + '/448x448.jpg';

      const imageStream = fs.createReadStream(imagePath);

      //assert error is thrown for invalid image
      const { data, format, md5, sha1 } = await computeHashesFromStream(imageStream,
        RequestEncoding.UNCOMPRESSED,
        ImageFormat.JPEG,
        false,
        [HashType.MD5, HashType.SHA1]
      );

      expect(data).toBeDefined();
      expect(format).toBe(ImageFormat.JPEG);

      expect(md5).toEqual('eb3a95fdd86ce28d9a63a68328783874');
      expect(sha1).toEqual('b972b222bc91c457d904ebff16134dc79b67d1c9');
    });

    it('should compute MD5 and SHA1 hashes for a resized invalid image', async ({expect}) => {
      // Test implementation here
      // Test implementation here
      const imagePath = __dirname + '/578x478.jpg';

      const imageStream = fs.createReadStream(imagePath);

      //assert error is thrown for invalid image
      const { data, format, md5, sha1 } = await computeHashesFromStream(imageStream,
        RequestEncoding.UNCOMPRESSED,
        ImageFormat.JPEG,
        true,
        [HashType.MD5, HashType.SHA1]
      );

      expect(data).toBeDefined();
      expect(format).toBe(ImageFormat.RAW_UINT8);

      expect(md5).toEqual('d390b6cd7436fd41d1bcd005e7e3e652');
      expect(sha1).toEqual('7f979ca35cfe390bd92f5dfa4a05919da76f0e43');
    });

    it('should throw an error for an invalid image', async ({expect}) => {
      // Test implementation here
      const imagePath = __dirname + '/578x478.jpg';

      const imageStream = fs.createReadStream(imagePath);

      //assert error is thrown for invalid image
      await expect(computeHashesFromStream(imageStream)).rejects.toThrow('Image must be 448x448 pixels');
    });
  });
});
