import { COMMITTEE_EMAIL, contactEnquiryEmail, validateContactEnquiry } from '../utils/contact.js';
import { rateLimit } from './rateLimit.js';

export const registerContactRoutes = (app, { sendEmail }) => {
  app.post('/api/contact', rateLimit(5, 60 * 1000), async (req, res) => {
    const { error, value } = validateContactEnquiry(req.body);
    if (error) return res.status(400).json({ error });

    try {
      const email = contactEnquiryEmail(value);
      const sent = await sendEmail({
        to: COMMITTEE_EMAIL,
        ...email,
        replyTo: value.email,
        record: { kind: 'contact-enquiry' }
      });
      if (!sent) {
        console.error('Contact enquiry email was not sent.');
        return res.status(503).json({ error: 'Your message could not be sent. Please try again later.' });
      }
      return res.json({ success: true });
    } catch (sendError) {
      console.error('Could not send contact enquiry:', sendError.message);
      return res.status(503).json({ error: 'Your message could not be sent. Please try again later.' });
    }
  });
};
