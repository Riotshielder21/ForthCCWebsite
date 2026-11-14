/**
 * Starting drafts for the club notices. Admins load them on the Notices page (Edit notices → Add drafted notices),
 * check and edit them there, and publish each one; from then on the published notice in Firestore is the record and
 * every change is a new numbered version. Editing a draft here does not change a notice that is already published.
 */

const SECRETARY = '[secretary@forthcanoeclub.co.uk](mailto:secretary@forthcanoeclub.co.uk)';
const TREASURER = '[treasurer@forthcanoeclub.co.uk](mailto:treasurer@forthcanoeclub.co.uk)';
const SAFEGUARDING = '[safeguarding@forthcanoeclub.co.uk](mailto:safeguarding@forthcanoeclub.co.uk)';

const PRIVACY_NOTICE = `This notice explains what personal information Forth Canoe Club collects, why, who it is shared with, how long it is kept and your rights. It applies to members, junior members and their parents or guardians, people who book events or courses, volunteers, and visitors to this website.

## Who we are

Forth Canoe Club SCIO is a Scottish Charitable Incorporated Organisation (SC050275), Harrison Park, Polwarth, Edinburgh EH11 1ED. The club is the data controller for the information described here. The club is run by volunteers; the committee is responsible for data protection.

Contact for anything about your information: ${SECRETARY}.

## What we collect

- Member and household details: names, date of birth, email address, phone number, postal address and postcode, membership type and history, and your Paddle Scotland (JustGo) membership number.
- Emergency contacts: the name, phone number and relationship of someone to contact in an emergency.
- Health and swimming: swimming ability, and any medical or other information you choose to tell us so that leaders can keep you safe.
- Under-18s: a junior's details, and their parent or guardian's name, contact details, address and relationship to them.
- Orders and payments: what you bought, prices, discounts and vouchers used, and payment status. Card and bank details are handled by Stripe; the club never sees or stores them.
- Subscriptions: monthly payment plans, payment dates, failed payments and cancellations.
- Consents and agreements: your answers to the participation disclaimer and photo and video consent, and which version of each notice you agreed to and when.
- Club nights and sessions: check-ins (who was on the water at which session), and a record of when a leader viewed someone's emergency contact.
- Volunteering: volunteer roles, hours, inductions, and safeguarding (PVG) checks where a role needs one.
- Boathouse and key access: who holds a key or access code, and when it was issued or returned.
- Messages and sign-in: emails you send us or forms you fill in, email sign-in codes and sessions for My details, and changes you make there.
- Photos and videos: only with consent (see the [Photo and Video Consent](/notices#photo-video-consent)).
- Website use: basic technical information needed to run and protect the website (such as IP address in security logs) and, only if you allow it, Google Analytics information about visits and page use (see [Cookies and Analytics](/notices#cookies-and-analytics)).

## Why we use it and our lawful basis

- To run your membership, bookings and purchases (joining, renewals, events, courses, hire, vouchers, merchandise, receipts and payments): this is necessary for our contract with you.
- To keep people safe on the water (swimming ability, emergency contacts, check-ins, incident records): our legitimate interest in running safe activities, and the contract with you.
- Medical information: this is special category data. We use it because you choose to give it to us so that leaders can look after you (your explicit consent), and in an emergency to protect someone's life (vital interests). You can ask us to remove it at any time.
- Affiliation with Paddle Scotland (sharing membership details so that you are covered by Paddle Scotland membership and insurance): necessary for our contract with you, and our legitimate interest in being an affiliated club.
- Safeguarding and PVG checks for volunteers: legal obligation and the substantial public interest in safeguarding children and adults at risk.
- Accounts and financial records: legal obligation (charity accounting rules).
- Club news and messages about your membership: our legitimate interest in keeping members informed. You can ask us to stop non-essential messages at any time.
- Volunteer records and benefits: our legitimate interest in organising volunteers and recognising their time.
- Anonymous statistics about who takes part and how (see [Data Analytics](/notices#data-analytics)): our legitimate interest in planning the club's activities and showing who the club serves. Counts of disability and health information are made only to monitor equality of opportunity.
- Photos and videos, and website analytics: your consent, which you can withdraw at any time.
- Security of the website and preventing misuse: our legitimate interest in keeping the website and your information secure.

## Who we share it with

We never sell your information. We share only what each organisation needs:

- Stripe takes card and Direct Debit payments.
- Google (Firebase, Cloud Run and Google Workspace) hosts the website, the club's database, file storage and club email.
- Paddle Scotland, through its JustGo membership system, for affiliation, membership records and insurance.
- Event leaders, coaches and check-in volunteers see the details of people at their sessions that they need to run them safely, such as names, swimming ability, medical information and emergency contacts. Access is limited and recorded.
- The emergency services or medical staff, if someone is hurt or ill.
- Disclosure Scotland, for PVG checks for volunteer roles that need one.
- Others where the law requires it, for example the police or OSCR.

Some of these providers store or process data outside the UK, including in the USA. Where they do, they protect it with safeguards approved under UK data protection law, such as the UK International Data Transfer Agreement or Addendum, or the UK–US data bridge.

## How long we keep it

We keep information only as long as we need it. The periods are set out in the [Data Retention](/notices#data-retention) notice. Anonymous statistics, such as the number of members each year, are kept after the personal information behind them is deleted (see [Data Analytics](/notices#data-analytics)).

## Your rights

You have the right to:

- ask for a copy of the information we hold about you;
- ask us to correct anything that is wrong (you can update most details yourself in [My details](/my-details));
- ask us to erase your information;
- ask us to restrict how we use it, or object to us using it;
- withdraw any consent you have given, for example photo and video consent in [My details](/my-details), without affecting anything done before;
- ask for information you gave us in a portable format.

To use any of these rights, email ${SECRETARY}. We reply within one month. Some information must be kept even after an erasure request, for example financial records the law requires us to keep, and erasing your details ends a membership (see the [Terms of Sale](/notices#terms-of-sale)).

If you are unhappy with how we have used your information, please contact us first. You can also complain to the Information Commissioner's Office (ICO) at [ico.org.uk](https://ico.org.uk/make-a-complaint/) or on 0303 123 1113.

## Children

Parents and guardians give the details, consents and agreements for under-18s, and can use the rights above on their behalf. Young people aged 12 and over can also ask about their own information.

## If something goes wrong

If there is a breach of personal information that risks people's rights, we report it to the ICO within 72 hours of finding out, and tell the people affected where the risk is high.

## Changes to this notice

We update this notice when what we do changes. Each change is published as a new version on this page, and you are asked to agree to the new version the next time you book or join.`;

const DATA_RETENTION = `This notice sets out how long Forth Canoe Club keeps personal information, and what happens to it afterwards. It goes with the [Privacy Notice](/notices#privacy-notice).

The club year runs from 1 March to the end of February. "After membership ends" means after the end of the last club year someone was a member.

## How long we keep each type of information

- Membership and household details (names, contact details, date of birth, membership history): while you are a member and for 2 club years after your membership ends, so that you can renew easily. Then deleted, apart from what is listed below.
- Medical information and swimming ability: while you are a member, and deleted with your membership details. You can ask us to remove medical information at any time.
- Emergency contacts: while you are a member, and deleted with your membership details.
- Parent or guardian details for under-18s: for as long as the junior's membership details are kept.
- Orders, payments, receipts and subscription records: 6 years after the end of the financial year they relate to, as charity accounting rules require. After the other details are deleted, these keep only what the accounts need.
- Consent and agreement records (disclaimer, photo and video consent, notice versions agreed to): for as long as the order or membership record they belong to, so that we can show what was agreed.
- Check-ins at club nights and sessions: 3 years, as a record of who was on the water in case of a later question about an incident.
- Records of leaders viewing emergency contacts: 3 years.
- Incident and accident reports: 3 years after the incident or, for someone under 18 at the time, until they reach 21, whichever is later.
- Volunteer records (roles, hours, inductions): while you volunteer and for 3 years after.
- PVG and safeguarding records: the date and outcome of checks only, while the volunteer role continues and for 3 years after. Disclosure certificates are not kept.
- Boathouse key and access records: while you hold access and for 1 year after it ends.
- Changes you make in My details: 2 years.
- Email sign-in codes: a few minutes; the sign-in session ends after a short time.
- Order look-up links: 90 days. Links to retry a failed payment: 30 days.
- Emails and contact form messages: 2 years, unless they are part of a record listed above.
- Photos and videos: reviewed every year; removed sooner if consent is withdrawn.
- Website security logs: 30 days.
- Website analytics (only with consent): Google Analytics retains event-level data according to the retention setting configured for the club's Google Analytics property. The club uses the reports in aggregate.

## Erasure on request

You can ask us to erase your information at any time by emailing ${SECRETARY}. We do this within one month. We keep only what the law requires, such as financial records, and remove your name from them where we can.

## Anonymous statistics

Before personal information is deleted we may keep anonymous statistics, such as the number of members, juniors, check-ins or volunteer hours in a year. These cannot identify anyone and are kept for as long as they are useful to the club. Whatever the period above, personal information is deleted or made anonymous no later than 7 years after someone's last contact with the club. How the statistics are made is explained in [Data Analytics](/notices#data-analytics).

## Reviewing this notice

The committee reviews these periods at least once a year. Changes are published as a new version of this notice.`;

const DATA_ANALYTICS = `This notice explains how Forth Canoe Club turns information about members and bookings into anonymous statistics, what those statistics are used for, and your choices. It goes with the [Privacy Notice](/notices#privacy-notice) and the [Data Retention](/notices#data-retention) notice.

## Why we keep statistics

As a volunteer-run charity, the club needs to understand who takes part and how, so that it can plan sessions, coaching and equipment, set fair prices, and show funders and partners who the club serves. Statistics also help us show that paddling at the club is open to everyone, including people who are under-represented in the sport.

## What the statistics cover

We count and average information we already hold for running the club. We do not ask for extra information just for statistics. The statistics include:

- Membership: the number of members by membership type and club year, and how many people join, renew and leave each year.
- Taking part: the number of people attending events, courses, trips and club nights, and how often people come.
- Breadth of attendance: the average number of different kinds of activity members take part in, such as club nights, trips, courses and events, worked out for the whole club or for broad groups, never reported for one person.
- Disciplines and activities: which paddling disciplines and activities people take part in.
- Age: the number of people in broad age ranges, such as under 12, 12 to 17, 18 to 25, 26 to 40, 41 to 60 and over 60.
- Area: the number of people from each area, using only the first half of the postcode (for example EH11).
- Spending: totals and averages per person, and spending by category, such as membership, events and courses, kit hire and merchandise.
- Volunteering: the number of volunteers, the roles they fill and the hours given.
- Inclusion: the number of people who have told us about a disability, medical condition or additional support need, counted in broad groups, so that we can show the club includes and supports them.

We do not currently ask about gender. If we add an optional question about gender in future, with a "prefer not to say" choice, it will be used only in the same anonymous way, and this notice will be updated first.

## How we make the statistics anonymous

- We count people into totals, averages and ranges. The statistics never contain names, contact details, exact dates of birth, full postcodes, membership numbers, payment references or any other code that could be linked back to a person.
- Ages are kept only as an age range, and areas only as the first half of the postcode.
- Spending is kept only as totals and averages for a group, never as what one person spent.
- Attendance and breadth of attendance are kept only as counts and averages for a group, never as a list of what one person attended.
- Health, disability and support information is kept only as a count in a broad group. We never record the details of anyone's condition in the statistics.
- Where a group has fewer than 5 people, we merge it with another group or show it as "fewer than 5", so that nobody can be picked out.
- The personal records used to work out the statistics are seen only by the committee members who need them. Only the anonymous results are shared.

Once information has been made anonymous it can no longer be linked to you, so it is no longer personal information.

## Our lawful basis

We make these statistics because it is in the club's legitimate interests to plan its activities, look after its finances and show the people it serves. We have considered your interests: the statistics are anonymous, they use information we already hold, and they are never used to make decisions about you.

Health and disability information is special category data. We count it only to monitor and promote equality of opportunity for people with disabilities or health conditions, as the Data Protection Act 2018 allows, and only as anonymous totals.

You are told about this when you join or book: agreeing to the club's notices at checkout confirms that you have read them. It is not a separate consent, and taking part does not depend on anything beyond the information we need to run your membership or booking.

## Who sees the statistics

- The committee, to plan and run the club.
- Members, for example in reports to the Annual General Meeting.
- Funders, Paddle Scotland, sportscotland, local councils and similar bodies, for example in grant applications and annual returns.

We never sell the statistics or use them for marketing.

## How long we keep information

- Personal information is kept only for the periods set out in the [Data Retention](/notices#data-retention) notice. Whatever else applies, we delete it or make it anonymous no later than 7 years after your last contact with the club, such as your last membership, booking, check-in, payment or volunteering.
- Information about former members stays in the statistics only in anonymous form, in the same way as for current members.
- Anonymous statistics are kept for as long as they are useful to the club, so that we can compare years.
- If you ask us to erase your information, we make it anonymous or delete it at the same time (see the [Privacy Notice](/notices#privacy-notice)).

## Website analytics

Website analytics are separate from the anonymous club statistics described above. Google Analytics runs only if you allow it. Google may process technical or pseudonymous browser identifiers to provide the service; the club uses the reports in aggregate and does not link browsing activity to membership or purchase records. You can change your choice at any time using Analytics settings in the footer. See [Cookies and Analytics](/notices#cookies-and-analytics).

## Your choices

- You can object to your information being included in future statistics, including the inclusion counts, by emailing ${SECRETARY}. We will stop including it. This does not affect your membership or bookings.
- Statistics that were made before you objected cannot be changed, because they are anonymous and cannot be traced back to you.
- Your other rights, and how to complain, are in the [Privacy Notice](/notices#privacy-notice).

## Changes to this notice

The committee reviews this notice at least once a year. Changes are published as a new version on this page.`;

const FIRST_AID_AND_SAFETY = `Paddlesport carries risk. This statement explains how Forth Canoe Club keeps people safe at its activities and what we ask of everyone who takes part. It goes with the [Participation Disclaimer](/notices#participation-disclaimer).

## Guidance we follow

The club is affiliated to Paddle Scotland and runs its activities following Paddle Scotland and British Canoeing safety and coaching guidance. See [Paddle Scotland](https://www.paddlescotland.org.uk/) for their guidance.

## Leaders, coaches and first aid

- Club sessions, courses and trips are led by coaches and leaders qualified for the activity and the water.
- At every club session and trip, at least one leader holds a current first aid certificate, and a first aid kit and rescue equipment are on hand.
- Leaders decide whether activities go ahead and may change or stop an activity because of the weather, water conditions or the group.

## Emergency procedures

- Leaders brief the group on what to do in an emergency, including capsize and rescue, at the start of each session.
- Leaders know the location of the nearest phone, access point for emergency vehicles and hospital.
- In an emergency a leader calls the emergency services (999, or the coastguard on tidal water) and contacts the person's emergency contact.
- The medical information and emergency contact you give at booking are available to the leader of the session, and every time they are viewed it is recorded.

## Buoyancy aids and kit

- Everyone on the water wears a correctly fitted buoyancy aid, provided by the club if you do not have your own.
- Helmets are worn where the activity or water needs them, as directed by the leader.
- Wear clothing suitable for getting wet and the conditions, and footwear that stays on. Leaders may stop someone taking part if their kit is not safe.
- Club boats and equipment are checked regularly. Tell a leader about any damage.

## Swimming ability

We ask everyone's swimming ability when they join or book. Being a confident swimmer is not required for every activity, but leaders use this information to plan the session, and some activities need a minimum level. Non-swimmers take part only in sheltered water with a buoyancy aid and close supervision.

## Juniors

- Under-18s are supervised by leaders at all times during club activities, with leader-to-paddler ratios set by Paddle Scotland guidance for the activity, water and the age and experience of the group.
- A parent or guardian must give the junior's details and accept the Participation Disclaimer for them, and must be contactable during the activity.
- Parents and guardians are responsible for juniors before and after the session.
- Our safeguarding arrangements are on the [Safeguarding](/safeguarding) page. Any concern about a child or adult at risk can be raised with the club's safeguarding officer at ${SAFEGUARDING}.

## Health

Tell the leader before the session about any medical condition, injury or medication that could affect you on the water, and if you feel unwell during it. Do not take part under the influence of alcohol or drugs.

## Reporting incidents

- Tell the leader straight away about any accident, injury, near miss or damage.
- The leader records the incident and reports it to the committee. Serious incidents are also reported to Paddle Scotland and, where the law requires, to the relevant authorities.
- The committee reviews every incident and changes how we do things where it helps.
- Questions about safety can be sent to ${SECRETARY}.`;

const TERMS_OF_SALE = `## Who you are buying from

Forth Canoe Club SCIO is a Scottish Charitable Incorporated Organisation (SC050275), Harrison Park, Polwarth, Edinburgh EH11 1ED. Questions about a purchase, refunds or monthly payments: ${TREASURER}.

These terms apply to everything bought on this website. They do not affect your legal rights as a consumer.

## Prices and payment

- Prices are in pounds sterling. The club is not registered for VAT, so no VAT is charged.
- Payments are taken by Stripe, by card or Bacs Direct Debit. We never see or store your card or bank details.
- Your purchase is confirmed when payment succeeds and we email your receipt. If a bank payment fails, we email you a link to try again. The link lasts 30 days.
- Discounts are applied automatically at checkout and shown before you pay. Examples are the kit hire or subscription discount on day trips, volunteer benefits and discount codes. You pay the total shown on the "Review and pay" step.

## The club year

The club year runs from 1 March to the end of February.

- Membership is a one-year contract for the club year it is bought for, paid in full when you join. It ends at the end of February, whenever in the year you joined. After the 14-day cancellation period it cannot be cancelled part way through the year. The only exception is if you ask us to erase your personal data under UK GDPR: we cannot keep you as a member without your details, so your membership ends when the data is erased. The membership fee is not refunded in that case.
- Annual kit hire covers the club year it is bought for and ends at the end of February.
- This year's items stop being sold in February. Memberships for the current year are sold until 7 February, and other items until 15 February. From 1 January you can also buy for the next club year.

## Monthly payments

- Payment dates: subscriptions, and other items you choose to pay monthly, are collected by Direct Debit on the 1st of each month. The last payment is on 1 February, and the payments stop on 1 March. You buy again for the next club year.
- Your first payment: when you join part way through a month, you first pay for the rest of that month. This is shown as a percentage off a full month.
- Paying for the year up front: this costs less than twelve monthly payments, and the saving is shown at checkout.
- Receipts: we email a receipt for every monthly payment.
- Stopping your payments: you can ask us to stop at any time. Use [My details](/my-details), or email the treasurer. We stop future payments, but we do not refund the month you have already paid for. What you have paid for continues to the end of that month. Stopping monthly payments does not end your membership.

## If a payment fails

- When a monthly payment fails: Stripe tries again over the following days, and we email you each time.
- If every attempt fails: your monthly payments stop. What they paid for ends on the date you had paid up to. Your membership is not affected. We email you a link to restart your payments or to confirm that you are stopping. We do not collect the months you missed.

## Your right to cancel (14 days)

The law gives you 14 days to change your mind about most things bought online. To cancel, email the treasurer within that time. You don't have to give a reason.

- Membership, subscriptions and kit hire: the 14 days start on the day you buy. If you start using them during the 14 days and then cancel, we may keep a fair amount for the time you had them.
- Merchandise: the 14 days start when you receive the item. Return it unworn and unused, with any tags still attached, by handing it to a committee member at the boathouse or posting it at your own cost. Items made or personalised to your order cannot be returned unless they are faulty.
- Gift and course vouchers: you can cancel within 14 days of buying, as long as the voucher has not been used.
- Events, courses and trips on a set date: these have no 14-day right to cancel. This is because they are leisure activities booked for a specific date. See the next section.

We refund to the card or account you paid with, within 14 days of agreeing the refund.

## Events, courses and trips

- If the club cancels or reschedules: we may cancel or move an event because of weather, water levels, safety or leader availability. If we do, you can have a full refund, or a place on the new date if there is one.
- If you can't come: tell us as soon as you can. You get a full refund if you cancel 7 days or more before the start. After that, we refund you only if we can fill your place.
- Before booking: some events need you to be a member, or to have your own kit or annual kit hire. These requirements are shown before you book.

## Vouchers

- Validity: a voucher is valid for one year from purchase.
- How it can be used: it can be used once. It works on the items it was sold for (for example, a course voucher works on that course) and never on membership. Any value left over after that use is lost.
- Value: vouchers cannot be exchanged for cash. They are not replaced if lost, so keep your code safe.

## Volunteer benefits

Volunteers who reach the published hours receive benefits such as a monthly discount or free kit hire. These benefits apply from your next payment or purchase after you qualify. Payments already made are not refunded or adjusted.

## Annual purchases after the 14 days

After the 14 days, membership is not refunded (see The club year). Annual kit hire and subscriptions paid for the year are not refunded either, except at the committee's discretion, for example for medical reasons. Ask the treasurer.

## Faulty items and services not as described

If something you bought is faulty, or a service is not provided as described, contact the treasurer. You are entitled to a repair, replacement, refund or price reduction under the Consumer Rights Act 2015.

## Complaints

- First: please email the treasurer. We aim to reply within 14 days.
- If you are not happy with the reply: you can ask the committee to review it through the club secretary, ${SECRETARY}.
- Independent advice: [Advice Direct Scotland](https://www.consumeradvice.scot/) can give you free consumer advice.

## Changes to these terms

We may update these terms. The version you accepted at checkout applies to that purchase. When the terms change, you will be asked to accept the new version the next time you buy.

These terms are governed by Scots law.`;

const COOKIES_AND_ANALYTICS = `This notice explains the browser storage and analytics used by the Forth Canoe Club website. It is separate from the club's statistics about membership, purchases and participation, described in the [Data Analytics](/notices#data-analytics) notice.

## Browser storage and cache

Your browser may cache website files, such as pages, scripts and images, so they load faster. The site also uses browser storage for features such as sign-in and to remember your Google Analytics choice. This information is stored on your device and can be cleared through your browser settings. This cache is not a browsing-history record held by the club.

## Analytics

Google Analytics for Firebase is optional. If you allow it, it measures visits and pages viewed so the club can understand how well the website is working and improve it. It can collect page URLs and titles, referring pages, session and engagement information, and technical details about the browser or device. Google may use cookies or similar browser storage and pseudonymous identifiers to provide these measurements. The club uses the reports in aggregate and does not link browsing activity to membership or purchase records. We do not send purchase events or membership details to Google Analytics.

Analytics runs only if you choose “Allow analytics.” You can choose “No thanks” or change your choice at any time using Analytics settings in the footer. Your choice does not affect anything else on the website. Google Analytics data is handled under the retention settings for the club's Google Analytics property.

## More information

See the [Privacy Notice](/notices#privacy-notice) for how the club uses personal information, and your rights. Questions: ${SECRETARY}.`;

const COPYRIGHT = `## Copyright

The content of this website, including text, photographs, videos, graphics and the club crest, is © Forth Canoe Club SCIO or the people who took the photographs and gave the club permission to use them, unless stated otherwise.

## Using our content

- You may view, download and print pages for your own personal, non-commercial use, and share links to them.
- Please do not copy, republish or change our photographs, videos, logos or text for any other purpose without written permission. Ask the club secretary at ${SECRETARY}.
- Photographs of people are used with their consent (see the [Photo and Video Consent](/notices#photo-video-consent)). Please do not reuse them.

## Other names and logos

Paddle Scotland, British Canoeing and other organisations' names and logos belong to their owners and are used to show the club's affiliations.

## Website software

The software that runs this website is open source and published under the Apache License 2.0. That licence covers the code only, not the club's content.

## Links to other websites

We are not responsible for the content of websites we link to.

## If you think we have used your work

If you think something on this website uses your work without permission, email ${SECRETARY} and we will look into it promptly.`;

export const NOTICE_DRAFTS = [
  { id: 'privacy-notice', title: 'Privacy Notice', body: PRIVACY_NOTICE },
  { id: 'terms-of-sale', title: 'Terms of Sale', body: TERMS_OF_SALE },
  { id: 'data-retention', title: 'Data Retention', body: DATA_RETENTION },
  { id: 'data-analytics', title: 'Data Analytics', body: DATA_ANALYTICS },
  { id: 'first-aid-and-safety', title: 'First Aid and Safety', body: FIRST_AID_AND_SAFETY },
  { id: 'cookies-and-analytics', title: 'Cookies and Analytics', body: COOKIES_AND_ANALYTICS },
  { id: 'copyright', title: 'Copyright', body: COPYRIGHT }
];
