const field = (label, value, multiline = false) => ({ label, value, multiline });

export const PAGE_CONTENT = {
  home: {
    label: 'Home',
    fields: {
      welcomeTitle: field('Welcome tile heading', 'Welcome'),
      welcome1: field('Welcome paragraph 1', "Welcome to Forth Canoe Club. We're a local, open, active, and friendly kayaking / canoeing club, right in the heart of Edinburgh. We can't wait to have you join us on the water!", true),
      welcome2: field('Welcome paragraph 2', "If you're a complete beginner or a bit scared to start, don't let that get in the way — that's what we're here for!", true),
      welcome3: field('Welcome paragraph 3 before link', 'We also cater to experienced, adventurous paddlers, already involved in a specific discipline or keen to compete.' , true),
      welcome3Link: field('Welcome paragraph 3 link text', 'All are most welcome members.'),
      welcome3After: field('Welcome paragraph 3 after link', '.'),
      welcome4Before: field('Welcome paragraph 4 before link', 'Total beginners might find the easiest way to get started is at one of our', true),
      welcome4Link: field('Welcome paragraph 4 link text', 'open nights'),
      welcome4After: field('Welcome paragraph 4 after link', '— usually held on the first Thursday of every month.', true),
      welcome5Before: field('Welcome paragraph 5 before link', 'Any questions,'),
      welcome5Link: field('Welcome paragraph 5 link text', 'get in touch'),
      welcome5After: field('Welcome paragraph 5 after link', '.'),
      startTitle: field('Where to Start heading', 'Where to Start'),
      startIntro: field('Where to Start intro', 'Here are a few useful details:'),
      start1: field('Where to Start item 1 after map link', "marks our clubhouse on Edinburgh's Union Canal, where many of our activities take place.", true),
      start1Link: field('Map link text', 'This map'),
      start1Url: field('Map URL', 'https://maps.app.goo.gl/forthcanoeclub'),
      start2Before: field('Where to Start item 2 before link', 'Our'),
      start2Link: field('Contact link text', 'contact details are here'),
      start2After: field('Where to Start item 2 after link', '.'),
      start3: field('Where to Start item 3', 'Children need to be 8 or older to join a kids class or to paddle in a one-person boat. Children under 8 can come to an open night, paddling together with a supervising adult in an open canoe.', true),
      start4: field('Where to Start item 4', 'Young people under 16 must be supervised by an accompanying adult at club nights.', true),
      start5Before: field('Where to Start item 5 before link', 'Information about our classes is on the'),
      start5Link: field('Disciplines link text', 'disciplines page'),
      start5After: field('Where to Start item 5 after link', '.'),
      charityEyebrow: field('Mission charity label', 'Registered Scottish Charity SC050275'),
      missionTitle: field('Mission heading', 'Our Mission'),
      missionIntro: field('Mission introduction', 'Forth Canoe Club is a registered Scottish Charity (SC050275) and is set up for the advancement of public participation in sport. In particular we seek to do the following:', true),
      mission1: field('Mission item 1', 'Foster, develop and advance public participation in paddle sports', true),
      mission2Title: field('Mission item 2 heading', 'Organise recreational and competitive activities', true),
      mission2: field('Mission item 2 text', 'For the practice of the sport of canoeing and kayaking. We support club members to gain awards, provide training and coaching, and provide opportunities for members to try different water sports activities.', true),
      mission3Title: field('Mission item 3 heading', 'Increase participation for individuals with disabilities', true),
      mission3: field('Mission item 3 text', 'To strive to increase participation in sport and recreation for individuals with disabilities or those facing barriers to other sports, by creating supportive environments, providing necessary resources, and championing adaptive sports initiatives.', true),
      charityLink: field('Charity register button', 'View on Charity Register'),
      charityUrl: field('Charity register URL', 'https://www.oscr.org.uk/about-charities/search-the-register/charity-details?number=SC050275'),
      quick1Eyebrow: field('Beginner tile label', 'Get Started'),
      quick1Title: field('Beginner tile heading', 'New to Paddling?'),
      quick1Body: field('Beginner tile text', 'Come along to one of our beginner sessions — no experience needed. We provide all kit and coaching. Your first 3 trial sessions are free.', true),
      quick1Action: field('Beginner tile button', 'Beginners'),
      quick2Eyebrow: field('Membership tile label', 'Membership'),
      quick2Title: field('Membership tile heading', 'Join the Club'),
      quick2Body: field('Membership tile text', 'Membership runs from 1 March each year. Subscribe for coached sessions, kit hire and access to our full programme of events and trips.', true),
      quick2Action: field('Membership tile button', 'Membership'),
      quick3Eyebrow: field('Volunteer tile label', 'Get Involved'),
      quick3Title: field('Volunteer tile heading', 'Volunteer'),
      quick3Body: field('Volunteer tile text', 'Our club runs on volunteers. Help with coaching, events, maintenance or administration and earn discount codes for your membership.', true),
      quick3Action: field('Volunteer tile button', 'Volunteering'),
      supportersEyebrow: field('Supporters label', 'Thank You'),
      supportersTitle: field('Supporters heading', 'Massive Thank You to All Our Access Project & Club Supporters'),
      sponsors: field('Supporter tiles (one per line: name | URL)', 'Garfield Weston Foundation | https://garfieldweston.org/\nPaddle Scotland | https://www.paddlescotland.org.uk/\nSportScotland | https://sportscotland.org.uk/\nCity of Edinburgh Council | https://www.edinburgh.gov.uk/\nAndy Jackson Fund for Access | https://www.andyjacksonfund.org.uk/\nAnalog Devices | https://www.analog.com/\nBoroughmuir High School | https://boroughmuirhighschool.org/\nNational Lottery Community Fund | https://www.tnlcommunityfund.org.uk/\nScottish Building Society | https://www.scottishbs.co.uk/', true),
      locationEyebrow: field('Location label', 'Find Us'),
      locationTitle: field('Location tile heading', 'Harrison Park, Polwarth'),
      locationBody: field('Location tile text', 'Edinburgh EH11 1ED — On the Union Canal, just west of the city centre.', true)
    }
  },
  membership: {
    label: 'Membership & Shop',
    fields: {
      title: field('Page heading', 'Store & Subscriptions'),
      intro: field('Page introduction', 'The club year runs from 1 March. Membership and annual kit hire cover the current club year, while annual subscriptions are prorated to the next 1 March renewal.', true),
      memberEyebrow: field('Membership tile label', 'MEMBERSHIP'),
      memberTitle: field('Membership tile heading', 'Club Membership Via Website'),
      memberBody: field('Membership tile text', "Join directly through our website. We'll set up your JustGo & SCA membership for you. Select your tier below.", true),
      externalAction: field('External membership button', 'JustGo'),
      annualPriceLabel: field('Annual price label', 'Annual Price'),
      clubYearPriceLabel: field('Club-year price label', 'Club Year Price'),
      monthlyPriceLabel: field('Monthly price label', 'Monthly Price'),
      voucherPriceLabel: field('Voucher price label', 'Gift Voucher')
    }
  },
  beginners: {
    label: 'Beginners',
    fields: {
      title: field('Page heading', 'Beginners'),
      intro: field('Page introduction', "Whether you're a complete beginner or returning after a long break, we welcome you. No prior experience needed. We provide all the kit and qualified instructors to help you get started safely on the water.", true),
      openEyebrow: field('Open night tile label', 'Every Thursday (April–October)'),
      openTitle: field('Open night tile heading', 'Open Night'),
      openBody: field('Open night tile text', 'No membership required. Just book online and come along. Our qualified instructors will help you get fitted with kit and guide your first steps into paddling. Sessions are around 1.5 hours and run between April and October.', true),
      youthNote: field('Open night youth note', 'For young people: Under 16s must be supervised by an adult. Children under 8 can paddle in an open canoe with a supervising adult.', true),
      openAction: field('Open night button', 'Book Open Night'),
      openUrl: field('Open night booking URL', 'https://events.humanitix.com/host/forth-canoe-club'),
      clubEyebrow: field('Club night tile label', 'Members Only'),
      clubTitle: field('Club night tile heading', 'Club Night'),
      clubBody: field('Club night tile text', "After joining, come down for regular uncoached paddling sessions on Thursdays between April and October. Works best if you've attended an intro course or several open nights first. Boat hire £10 per session, or £70 per year for regular paddlers.", true),
      clubNote: field('Club night note', 'No need to book — just check club emails to confirm sessions are running.', true),
      coursesEyebrow: field('Courses tile label', 'Guided Learning'),
      coursesTitle: field('Courses tile heading', 'Paddle Courses'),
      coursesBody: field('Courses tile text', 'Open to members and non-members. Learn the basics and progress to more technical skills. Discover and Explore courses cover kayak, canoe, and paddle board. Kids and teens courses available during holidays and after school.', true),
      essentialsEyebrow: field('Essentials tile label', 'What to Bring'),
      essentialsTitle: field('Essentials tile heading', 'Essentials'),
      essentialsBody: field('Essentials tile text', 'Towel\nClothes for paddling (will get wet)\nWarm change of clothes\nFlat shoes that stay on in water\n\nNo wetsuit needed, but helpful if you have one. Basic changing rooms and portaloo available.', true)
    }
  },
  disciplines: {
    label: 'Disciplines',
    fields: {
      title: field('Page heading', 'Disciplines'),
      intro: field('Page introduction', 'From competitive racing to relaxed touring, Forth Canoe Club covers a wide range of paddling disciplines.', true),
      slalomTitle: field('Slalom tile heading', 'Slalom'),
      slalomBody: field('Slalom tile text', 'Navigate downstream through hanging gates against the clock. Training Tuesday evenings at 19:00 on the canal. A technical challenge that develops precise boat control. Included in session subscriptions.', true),
      poloTitle: field('Polo tile heading', 'Polo'),
      poloBody: field('Polo tile text', 'Team sport combining paddling and ball handling. Beginner friendly Friday 18:00, intermediate Wednesday 19:00, advanced Monday 18:00. Play in Scottish divisions or just for fun. Included in subscriptions.', true),
      sprintTitle: field('Sprint & Marathon tile heading', 'Sprint & Marathon'),
      sprintBody: field('Sprint & Marathon tile text', 'Flat-water racing from sprint speed trials to long-distance marathons. Coached sessions Thursday 18:00. Compete nationally or just enjoy smooth paddling and great technique.', true),
      whitewaterTitle: field('White Water tile heading', 'White Water'),
      whitewaterBody: field('White Water tile text', "Explore Scotland's rivers with the rush of moving water. Includes white water trips for adventure, white water racing for speed, and river coaching. Trips organised by request.", true),
      touringTitle: field('Flat Water Touring tile heading', 'Flat Water Touring'),
      touringBody: field('Flat Water Touring tile text', 'Relaxed paddling on lochs and slow rivers. Explore the Scottish landscape by boat. Perfect for those wanting to escape without the competitive edge.', true),
      surfTitle: field('Surf Kayaking tile heading', 'Surf Kayaking'),
      surfBody: field('Surf Kayaking tile text', 'Ride sea swells and enjoy coastal paddling. FCC has produced world-class surf kayakers including Neil Baxter. Feel the adrenaline and fresh sea air.', true)
    }
  },
  volunteering: {
    label: 'Volunteering',
    fields: {
      title: field('Page heading', 'Volunteering'),
      intro: field('Page introduction', 'Forth Canoe Club runs on volunteers. Every contribution — from coaching and events to maintenance and fundraising — makes a real difference. We reward volunteer commitment with substantial discounts on memberships and activities.', true),
      tier1Eyebrow: field('20+ hour tier label', '20+ hours'),
      tier1Title: field('20+ hour tier heading', 'Get Started'),
      tier1Body: field('20+ hour tier text', '£5 discount per month on unlimited subscriptions + free key hire.', true),
      tier2Eyebrow: field('40+ hour tier label', '40+ hours'),
      tier2Title: field('40+ hour tier heading', 'Regular Volunteer'),
      tier2Body: field('40+ hour tier text', 'Fixed £10/month unlimited subscriptions + free boat & equipment hire + free key hire.', true),
      tier3Eyebrow: field('60+ hour tier label', '60+ hours'),
      tier3Title: field('60+ hour tier heading', 'Core Team'),
      tier3Body: field('60+ hour tier text', 'Free equipment hire, subscriptions, key hire, + 25% discount on coaching courses.', true),
      waysTitle: field('Ways to Volunteer heading', 'Ways to Volunteer'),
      waysList: field('Volunteer opportunities (one per line: title | description)', 'Canal Festival | The most important community event of the year\nMaintenance | Painting, cleaning, weeding, and building at the clubhouse\nCoaching | Shadowing coaches, helping at pool and summer sessions, running beginner classes\nKey Holding | Open the club for club nights and open nights\nEquipment Repair | Plastic welding, carbon repairs, wooden canoe seats, airbag fixes\nFundraising | Grant applications, baking stalls, community events\nAccess Project | Join our subcommittee working on accessibility improvements', true),
      formTitle: field('Volunteer form heading', 'Get Involved'),
      formDescription: field('Volunteer form description', 'Sign up for volunteering opportunities or log equipment needs.', true)
    }
  },
  about: {
    label: 'About Us',
    fields: {
      eyebrow: field('Charity label', 'Scottish Charity SC050275'),
      title: field('Page heading', 'About Us'),
      intro: field('Page introduction', 'Forth Canoe Club is a Scottish Charitable Incorporated Organisation (SCIO), charity number SC050275, based at Harrison Park on the Union Canal in Edinburgh.', true),
      charityAction: field('Charity register button', 'Charity Register'),
      charityUrl: field('Charity register URL', 'https://www.oscr.org.uk/about-charities/search-the-register/charity-details?number=SC050275'),
      tile1Eyebrow: field('Club tile label', 'Our Story'),
      tile1Title: field('Club tile heading', 'The Club'),
      tile1Body: field('Club tile text', "Forth Canoe Club is one of Edinburgh's longest-running paddling clubs. We're welcoming, open, and active, catering to paddlers of all ages and abilities. Whether you want to race competitively, explore Scotland's rivers, or simply enjoy time on the water, there's a place for you at FCC.", true),
      tile2Eyebrow: field('Governance tile label', 'Community Run'),
      tile2Title: field('Governance tile heading', 'Governed by Members'),
      tile2Body: field('Governance tile text', "As a Scottish Charitable Incorporated Organisation (SCIO), we're run entirely by our members through an elected committee. We hold an Annual General Meeting each year where members shape the club's direction. All surplus funds are reinvested into equipment, coaching, and facilities.", true),
      tile3Eyebrow: field('Affiliation tile label', 'Affiliation'),
      tile3Title: field('Affiliation tile heading', 'Paddle Scotland'),
      tile3Body: field('Affiliation tile text', 'We are affiliated with Paddle Scotland (formerly SCA) and Paddle UK. Club membership includes PS affiliation, giving you access to coaching awards, insurance, competitions, and events across Scotland.', true),
      tile4Eyebrow: field('Safeguarding tile label', 'Safeguarding'),
      tile4Title: field('Safeguarding tile heading', 'Safety First'),
      tile4Body: field('Safeguarding tile text', 'We take safeguarding seriously. All coaches hold current PVG disclosures and follow Paddle Scotland safeguarding policies. We have a dedicated Safeguarding Officer to ensure a safe environment for all members, especially young people and vulnerable adults.', true)
    }
  },
  'access-project': {
    label: 'Access Project',
    fields: {
      title: field('Page heading', 'Access Project'),
      intro: field('Page introduction', 'Making paddling accessible to everyone. Our Access Project works to remove barriers and create opportunities for people who might not otherwise have access to water sports.', true),
      tile1Eyebrow: field('Vision tile label', 'The Challenge'),
      tile1Title: field('Vision tile heading', 'Our Vision'),
      tile1Body: field('Vision tile text', "Paddlesports can be accessible for people with disabilities. We want to be a pathway club for ParaCanoe athletes. Currently, wheelchair users must be lifted in and out of boats — we're working to change that and restore independence and autonomy. We're also advocating for accessible facilities like changing rooms and showers.", true),
      tile2Eyebrow: field('Approach tile label', 'Our Approach'),
      tile2Title: field('Approach tile heading', 'Inclusive Design'),
      tile2Body: field('Approach tile text', '“It’s what you can do, rather than what you can’t do.” We work with individuals facing barriers to paddling, adapting sessions to meet their needs. Well-designed access improves the site for everyone.', true),
      tile3Eyebrow: field('Timeline tile label', 'Track Progress'),
      tile3Title: field('Timeline tile heading', 'Project Timeline'),
      tile3Body: field('Timeline tile text', "We've completed feasibility studies and secured £32,000+ in pledges. We're now working through surveys, funding applications, designs, and approvals. Building work will follow once final funding is in place.", true),
      timelineAction: field('Timeline link text', 'View full timeline'),
      timelineUrl: field('Timeline URL', 'https://www.forthcanoeclub.co.uk/access-project'),
      tile4Eyebrow: field('Fundraising tile label', 'Get Involved'),
      tile4Title: field('Fundraising tile heading', 'Support Our Work'),
      tile4Body: field('Fundraising tile text', 'Help us make paddling accessible to everyone. Volunteer with the project, contribute skills, or donate to the fundraiser.', true),
      donateAction: field('Donation button', 'Donate Now'),
      donateUrl: field('Donation URL', 'https://www.justgiving.com/campaign/forth-access-project')
    }
  },
  contact: {
    label: 'Contact Us',
    fields: {
      title: field('Page heading', 'Contact Us'),
      intro: field('Page introduction', "Got a question or want to book a session? Get in touch and we'll get back to you as soon as we can.", true),
      addressEyebrow: field('Address tile label', 'Mailing Address'),
      addressTitle: field('Address tile heading', 'Find Us'),
      address: field('Mailing address (one line per row)', 'Forth Canoe Club\nHarrison Park\nPolwarth\nEdinburgh EH11 1ED', true),
      mapAction: field('Map link text', 'View on maps'),
      mapUrl: field('Map URL', 'https://maps.app.goo.gl/forthcanoeclub'),
      emailEyebrow: field('Email tile label', 'General Enquiries'),
      emailTitle: field('Email tile heading', 'Get in Touch'),
      emailAddress: field('Enquiry email', 'secretary@forthcanoeclub.co.uk'),
      responseTime: field('Response time message', 'We aim to respond within 48 hours.', true),
      socialEyebrow: field('Social tile label', 'Social Media'),
      socialTitle: field('Social tile heading', 'Follow Us'),
      facebookUrl: field('Facebook URL', 'https://www.facebook.com/forth.canoeclub'),
      facebookLabel: field('Facebook link label', 'Facebook'),
      instagramUrl: field('Instagram URL', 'https://www.instagram.com/forthcanoeclub'),
      instagramLabel: field('Instagram link label', 'Instagram'),
      supportTitle: field('Supported paddling heading', 'Need Special Support?'),
      supportBody: field('Supported paddling text', 'If you need additional support to get involved due to disability or long-term condition, contact our Supported Paddling coordinator.', true),
      supportEmail: field('Supported paddling email', 'supported.paddling@forthcanoeclub.co.uk')
    }
  }
};

export const getPageCopy = (pageId, saved = {}) => {
  const fields = PAGE_CONTENT[pageId]?.fields || {};
  return Object.fromEntries(Object.entries(fields).map(([key, definition]) => [key, saved[key] ?? definition.value]));
};
