import { Router, Request, Response } from 'express';
import { getUploadSignature } from '../utils/cloudinary';

const router = Router();

router.get('/signature', (req: Request, res: Response) => {
  res.json(getUploadSignature());
});

export default router;
