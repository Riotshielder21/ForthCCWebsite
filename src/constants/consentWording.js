/**
 * Wording ticked for each person at checkout and check-in. `label` sits beside the tick box and `body` is the full text
 * the person can open from it; both are versioned together (see DISCLAIMER_TEXT and PHOTO_CONSENT_TEXT in checkout.js),
 * so any change here is recorded as a new policy version on release and asks people to tick again.
 * The body uses the Notices markup: blank lines between paragraphs, `## ` headings, `- ` and `1. ` lists, `[text](link)`.
 */

export const DISCLAIMER = {
  id: 'participation-disclaimer',
  title: 'Participation Disclaimer',
  label: 'I have read and accept the Participation Disclaimer for this person. If they are under 18, I am their parent or guardian and accept it on their behalf.',
  body: `Paddlesport is an adventure activity on moving and open water. This disclaimer applies to every Forth Canoe Club activity: club nights, coached sessions, courses, pool sessions, trips, events and the use of club boats and equipment.

In this disclaimer "the paddler" means the person it is ticked for. If the paddler is under 18, their parent or guardian gives these confirmations for them.

## By ticking the box you confirm that

1. The details given for the paddler are correct and complete, including their swimming ability, any medical or other information we should know, and their emergency contact. You will tell the club if any of these change.
2. You give consent for the paddler to take part in club activities, and you understand there is a degree of risk involved, including capsize, cold water, strains and other injuries and, rarely, serious injury or drowning.
3. The paddler will follow the instructions of the coaches and leaders, wear a buoyancy aid and suitable clothing and kit as directed, and tell a leader if they are unwell, injured or unable to continue.
4. You give consent for Forth Canoe Club leaders to act on the paddler's behalf in the event of an incident or illness affecting them, including calling the emergency services and contacting the paddler's emergency contact.
5. You give consent for the paddler to be treated by a trained first aider and, if necessary, to be rescued by a trained coach or leader.
6. If the paddler needs urgent medical treatment and you or their emergency contact cannot be reached, a leader may go with them and pass on the medical information you gave to the people treating them.

## What the club does

The club runs its activities following Paddle Scotland guidance, as set out in the [First Aid and Safety](/notices#first-aid-and-safety) notice. Safeguarding information for juniors and adults at risk is on the [Safeguarding](/safeguarding) page.

Nothing in this disclaimer limits the club's liability for death or personal injury caused by its negligence, or any other liability that cannot be limited by law.

How the club uses the information you give is explained in the [Privacy Notice](/notices#privacy-notice).`
};

export const PHOTO_CONSENT = {
  id: 'photo-video-consent',
  title: 'Photo and Video Consent',
  label: 'Optional: I consent to photos and videos of club activities that this person takes part in being taken and used by Forth Canoe Club for the purposes described in the Photo and Video Consent.',
  body: `This consent is optional. Saying no never affects booking, membership or taking part in any club activity. If the person is under 18, their parent or guardian answers for them.

## What it covers

Photos and videos taken at club activities (club nights, coached sessions, courses, trips and events) by coaches, leaders, volunteers and members taking pictures for the club.

## How the club uses them

- On the club website and the club's social media accounts.
- In newsletters and emails to members.
- On posters, leaflets and displays that promote the club and paddlesport.
- In reports and applications to funders, Paddle Scotland and other partners that support the club.
- For coaching feedback, such as video of a paddling technique. Coaching video is shared only with the paddler (or their parent or guardian) and their coaches.

## How we look after them

- We do not publish the full name of anyone under 18 alongside their photo, and we do not publish anyone's contact details.
- We only use images that show people appropriately dressed and taking part safely.
- Photos and videos are kept in the club's own storage, and only club volunteers who need them can see them.
- We do not sell images or let others use them for their own purposes.

## Changing your mind

You can withdraw consent at any time in [My details](/my-details) or by emailing [secretary@forthcanoeclub.co.uk](mailto:secretary@forthcanoeclub.co.uk). We then stop using new images of the person and remove existing ones from the club website and club social media where we can. Printed material that has already been handed out cannot be recalled.

If consent is not given or is withdrawn, we try not to photograph the person. If they appear in a group or background picture, we do not publish it in a way that identifies them.

Photos and videos taken by other people at public venues are not under the club's control.

The legal basis for using photos and videos is consent, as explained in the [Privacy Notice](/notices#privacy-notice).`
};

/** The wording recorded for a tick: the statement beside the box followed by the full text it refers to. */
export const tickWording = ({ label, body }) => `${label}\n\n${body}`;
