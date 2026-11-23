import { BANNER_PAGES, currentTileLayout, getBanner, getSupporterTiles } from '../utils/pageTiles.js';
import { validateContentLinks } from '../utils/contentLinks.js';

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
      welcome3Text: field('Welcome paragraph 3', '', true),
      welcome4Text: field('Welcome paragraph 4', '', true),
      welcome5Text: field('Welcome paragraph 5', '', true),
      startTitle: field('Where to Start heading', 'Where to Start'),
      startIntro: field('Where to Start intro', 'Here are a few useful details:'),
      start1: field('Where to Start item 1 after map link', "marks our clubhouse on Edinburgh's Union Canal, where many of our activities take place.", true),
      start1Link: field('Map link text', 'This map'),
      start1Url: field('Map URL', 'https://www.google.com/maps/search/?api=1&query=Forth+Canoe+Club%2C+Harrison+Park%2C+Polwarth%2C+Edinburgh+EH11+1ED'),
      start2Before: field('Where to Start item 2 before link', 'Our'),
      start2Link: field('Contact link text', 'contact details are here'),
      start2After: field('Where to Start item 2 after link', '.'),
      start3: field('Where to Start item 3', 'Children need to be 8 or older to join a kids class or to paddle in a one-person boat. Children under 8 can come to an open night, paddling together with a supervising adult in an open canoe.', true),
      start4: field('Where to Start item 4', 'Young people under 16 must be supervised by an accompanying adult at club nights.', true),
      start5Before: field('Where to Start item 5 before link', 'Information about our classes is on the'),
      start5Link: field('Disciplines link text', 'disciplines page'),
      start5After: field('Where to Start item 5 after link', '.'),
      start1Text: field('Where to Start item 1', '', true),
      start2Text: field('Where to Start item 2', '', true),
      start5Text: field('Where to Start item 5', '', true),
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
      quick3Body: field('Volunteer tile text', 'Our club runs on volunteers. Help with coaching, events, maintenance or administration and receive benefits on your membership profile after induction.', true),
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
    label: 'Membership & Events',
    fields: {
      title: field('Page heading', 'Membership and Events'),
      intro: field('Page introduction', 'The club year runs from 1 March. Membership and annual kit hire cover the current club year, while annual subscriptions are prorated to the next 1 March renewal.', true),
      memberEyebrow: field('Membership tile label', 'MEMBERSHIP'),
      memberTitle: field('Membership tile heading', 'Club Membership'),
      memberBody: field('Membership tile text', "Join directly through our website. We'll set up your JustGo & Paddle Scotland membership for you. Select your tier below.", true),
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
      clubBody: field('Club night tile text', "After joining, come down for regular uncoached paddling sessions on Thursdays between April and October. Works best if you've attended an intro course or several open nights first.", true),
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
      slalomBody: field('Slalom tile text', 'Navigate downstream through hanging gates against the clock. A technical challenge that develops precise boat control. Included in session subscriptions.', true),
      poloTitle: field('Polo tile heading', 'Polo'),
      poloBody: field('Polo tile text', 'Team sport combining paddling and ball handling, with beginner-friendly, intermediate and advanced sessions. Play in Scottish divisions or just for fun. Included in subscriptions.', true),
      sprintTitle: field('Sprint & Marathon tile heading', 'Sprint & Marathon'),
      sprintBody: field('Sprint & Marathon tile text', 'Flat-water racing from sprint speed trials to long-distance marathons, with sessions in summer and winter. Compete nationally or just enjoy smooth paddling and great technique.', true),
      whitewaterTitle: field('White Water tile heading', 'White Water'),
      whitewaterBody: field('White Water tile text', "Explore Scotland's rivers with the rush of moving water. Includes white water trips for adventure, white water racing for speed, and river coaching. Trips organised by request.", true),
      touringTitle: field('Flat Water Touring tile heading', 'Flat Water Touring'),
      touringBody: field('Flat Water Touring tile text', 'Relaxed paddling on lochs and slow rivers. Explore the Scottish landscape by boat. Perfect for those wanting to escape without the competitive edge.', true),
      surfTitle: field('Surf Kayaking tile heading', 'Surf Kayaking'),
      surfBody: field('Surf Kayaking tile text', 'Ride sea swells and enjoy coastal paddling. FCC has produced world-class surf kayakers including Neil Baxter. Feel the adrenaline and fresh sea air.', true),
      canoeTitle: field('Tile 8 title', ''),
      canoeBody: field('Tile 8 description', '', true),
      paddleboardingTitle: field('Tile 9 title', ''),
      paddleboardingBody: field('Tile 9 description', '', true),
      supportedTitle: field('Supported paddling heading', 'Supported and adaptive paddling'),
      supportedBody: field('Supported paddling text', 'We welcome enquiries from paddlers with disabilities and additional support needs. Please contact the Supported Paddling coordinator before visiting to discuss your needs and confirm current arrangements. Our Access Project is working to improve independence and facilities.', true),
      supportedCoordinatorLabel: field('Supported paddling contact link text', 'Contact the Supported Paddling coordinator'),
      supportedCoordinatorUrl: field('Supported paddling contact URL', '/contact-us#support'),
      supportedProjectLabel: field('Access Project link text', 'Learn about the Access Project'),
      supportedProjectUrl: field('Access Project URL', '/access-project')
    }
  },
  'everything-else': {
    label: 'Everything Else',
    fields: {
      title: field('Page heading', 'Everything Else'),
      intro: field('Page introduction', 'Frequently asked questions and a few other parts of the club website.', true),
      faqTrialHeading: field('FAQ: sessions heading', 'How do I try paddling with the club?'),
      faqTrialAnswer: field('FAQ: sessions answer', 'Open-night sessions run seasonally and need to be booked online. You do not need to be a member to attend, and your first three trial sessions are free. Check the [Beginners page](/beginners) for current details and booking information.', true),
      faqMembershipHeading: field('FAQ: membership heading', 'When do I need to become a member?'),
      faqMembershipAnswer: field('FAQ: membership answer', 'Membership is required after your first three trial sessions. Current membership options and prices are listed on the [Membership and Events page](/membership); prices can change, so check the live listing.', true),
      faqWhatToBringHeading: field('FAQ: what to bring heading', 'What should I bring to a session?'),
      faqWhatToBringAnswer: field('FAQ: what to bring answer', 'Bring a towel, clothes that can get wet, a warm change of clothes, and flat shoes that will stay on in the water. A wetsuit is optional. See the [Beginners page](/beginners) for current guidance.', true),
      faqChildrenHeading: field('FAQ: children heading', 'Can children come paddling?'),
      faqChildrenAnswer: field('FAQ: children answer', 'Young people under 16 must be supervised by an accompanying adult at club nights. Children under 8 may paddle in an open canoe with a supervising adult; children need to be at least 8 to join a kids class or paddle in a one-person boat. Check the [Beginners page](/beginners) before booking.', true),
      faqHireHeading: field('FAQ: equipment hire heading', 'Can I hire a boat or equipment?'),
      faqHireAnswer: field('FAQ: equipment hire answer', 'Current boat and kit hire options, prices and terms are shown on the [Membership and Events page](/membership). If you need equipment for a single visit or are not yet a member, contact the club before booking to confirm what is available and who can use it.', true),
      faqTripsHeading: field('FAQ: trips heading', 'How do I find out about paddling trips?'),
      faqTripsAnswer: field('FAQ: trips answer', 'White water trips are organised by request. See the [Disciplines page](/disciplines) for more information, check the [Membership and Events page](/membership) for current listings, or contact the club to ask about a trip.', true),
      faqExperiencedHeading: field('FAQ: experienced paddlers heading', 'I have paddling experience. How do I join a session?'),
      faqExperiencedAnswer: field('FAQ: experienced paddlers answer', 'Contact the club through the [Contact Us page](/contact-us) and describe your experience, qualifications and the discipline you are interested in. A club lead can advise which session is appropriate and whether an introduction or skills check is needed.', true),
      faqSupportedHeading: field('FAQ: supported paddling heading', 'Can the club support paddlers with additional access needs?'),
      faqSupportedAnswer: field('FAQ: supported paddling answer', 'Please contact our [Supported Paddling coordinator](mailto:supported.paddling@forthcanoeclub.co.uk) before visiting to discuss your needs and confirm current access arrangements. You can also read about the [Access Project](/access-project).', true),
      faqClubNightHeading: field('FAQ: club night heading', 'How does club night work?'),
      faqClubNightAnswer: field('FAQ: club night answer', 'On club nights the boathouse is open for members to use club boats; the [weekly timetable](/disciplines) shows the current days and times. A volunteer is on duty in or around the boathouse. They are not necessarily a coach, so club nights are for members who can get themselves safely on and off the water, though they will help if they can. Before you paddle out of sight of the boathouse we need to know you can cope with a capsize in the craft you use: you might be asked to show this, unless you have done it on a course with us or have previous experience. Kit hire charges apply on club nights.', true),
      faqCoursesHeading: field('FAQ: adult courses heading', 'How do courses for adults work?'),
      faqCoursesAnswer: field('FAQ: adult courses answer', 'We run courses in canoeing, kayaking and paddleboarding, including Discover (for beginners) and Explore (for people who have done some paddling before) in canoeing and kayaking. Other courses can be arranged depending on demand and coach availability: if there is something you want to learn that we are not offering, let us know, as we only need three or four people to make a course viable. Kit hire is included in courses. Current courses are on the [Membership and Events page](/membership).', true),
      faqPoloHeading: field('FAQ: canoe polo heading', 'How does canoe polo work?'),
      faqPoloAnswer: field('FAQ: canoe polo answer', 'Polo sessions are on the [weekly timetable](/disciplines). You need to be 14 or over and able to get out of the boat if you capsize. Members are welcome to come along and try it a few times before deciding whether to sign up.', true),
      faqSlalomHeading: field('FAQ: slalom and sprint heading', 'How do slalom and sprint work?'),
      faqSlalomAnswer: field('FAQ: slalom and sprint answer', 'Slalom and sprint sessions are for paddlers aged 14 and over, and are a great way to take your paddling further. See the [Disciplines page](/disciplines) for details.', true),
      faqAccessHeading: field('FAQ: wheelchair access heading', 'The boathouse is downstairs. How can a wheelchair user get to the water?'),
      faqAccessAnswer: field('FAQ: wheelchair access answer', 'We are working to make the site more accessible through the [Access Project](/access-project). For now, wheelchair users can come down the ramp in the park to the canal side, where we use Canadian canoes and specialist equipment to transfer paddlers, with all their equipment, across the canal to the clubhouse. Please contact our [Supported Paddling coordinator](mailto:supported.paddling@forthcanoeclub.co.uk) before your visit.', true),
      faqVolunteeringHeading: field('FAQ: volunteering heading', 'How does volunteering work?'),
      faqVolunteeringAnswer: field('FAQ: volunteering answer', 'The club runs on volunteer power and more volunteers are always welcome, from work days getting the boathouse in order to joining the committee. Opportunities are shared in club emails, on the club Facebook page and on the boathouse noticeboard, but if you are keen to get involved just let us know. Volunteers get benefits such as reduced costs, with more for more pledged volunteer hours. See the [Volunteering page](/volunteering) for current roles and benefits.', true),
      faqSocialsHeading: field('FAQ: social events heading', 'What social events and meetings are there?'),
      faqSocialsAnswer: field('FAQ: social events answer', 'The first and last club nights of the season are usually club barbecues: vegetarian food and soft drinks are free for members, you are welcome to bring your own, and children are welcome. Committee meetings and the AGM are open to all members. At the AGM we get through the formalities quickly, give out awards for the year’s achievements and then socialise. There are occasional other socials too.', true),
      historyTitle: field('History tab heading', 'Club History'),
      historyBody: field('History text', 'Forth Canoe Club has a rich history in the city going back to 1934. Explore our history and how it shaped the club.\n\n1952 | The early pioneer era\nAllan Sharples and early Forth Canoe Club members begin recording Scottish canoeing history. Colour film and photography in the early 1950s were expensive commitments, so these records are rare early archives of British kayaking. See the [Allan Sharples photo collection](https://www.canoeingphotos.com/Photo-Collections/Allan-Sharples-Collection).\n\n1955 | Folding craft and tidal rapids\nFolding boats (“F1”) are the standard slalom class. Club members, including Allan Sharples, John Roberts, Brian Palmer, Dougal Lauder, Robin Anderson, Neville Eilbeck and David Anderson, pioneer tidal rapid runs down the [Falls of Lora](https://www.fallsoflora.info) and [Corryvreckan](https://isleofjura.scot/paddleboarding-jura-safety-guide-for-the-sound-of-jura-corryvreckan/) in 4-metre folding craft.\n\n1960 | National competition and home-made gear\nCine film captures Marsh Lock (1959) and the British Nationals at Llangollen (1960): see [Allan Sharples’ films](https://www.canoeingphotos.com/Videos/Allan-Sharples-Films). Competitors take racing seriously in full vests, but instead of official BS3595 life jackets they make buoyancy aids by sewing two Dunlopillo camping pillows together with cotton tape.\n\n1963 | The GRP revolution and Thistlebrig\nIn 1962–1963 GRP (glass reinforced plastic) boats come into slalom. Allan moves to composite hulls costing around £25–£35 (the licensed Isère at £35, or Chris Hawkesworth’s Inn Spezial replica at £27), compared with £75 for a folding Klepper. The club hosts ranking events at Thistlebrig, rigging Sunday “mini-slaloms” with 3mm terylene cord, and cine footage records events at Serpent’s Tail (1962), [Grandtully](https://www.canoeslalom.co.uk/events/venues/grandtully/) (1962–1964) and Builth Wells (1963).\n\n1965 | Peak archives and iconic designs\nFootage records the 1965 River Lune trip and the Fairnilee slaloms, hosted with Edinburgh University Canoe Club. Iconic boats of the period include John Critchley’s JayCee Cobra, and Keith White’s British Team slalom boats (KW 3, KW 7) and wildwater racer (KW 4).\n\n1971 | Preserving the heritage\nDecades of club history, classic boat designs and early river runs are preserved. Mike Sharples has digitised 28 cine film clips (1959–1965) and 35mm slide collections, now on canoeingphotos.com: see the [films](https://www.canoeingphotos.com/Videos/Allan-Sharples-Films) and the [slide collection](https://www.canoeingphotos.com/Photo-Collections/Allan-Sharples-Collection).\n\n2004 | The canal drained at Lochrin Basin\nIn February 2004 the canal was drained, and the club’s old buildings at Lochrin Basin were demolished to make room for offices. Photos from Leamington Lift Bridge (J. Riddell) show how wide the canal used to be.\n\n2013 | By Harrison Park\nThe club on the canal by Harrison Park, a popular spot especially in the school holidays: photos on Blipfoto by [hcalibrarian](https://www.blipfoto.com/entry/3273949) and [onedayandcanal](https://www.blipfoto.com/entry/2310038343066323702).', true),
      magazineTitle: field('Kayak Magazine tab heading', 'Kayak Magazine'),
      magazineBody: field('Kayak Magazine text', 'In 1973 Forth Canoe Club was 50 years old, and had produced “The Spraysheet” news and also CANews. The inspiration came from the “Edinburgh Schools Newsletter”, published by Edinburgh Outdoor Pursuits Centre and Boroughmuir High School, who ran weekly Wednesday afternoon canoeing trips for school pupils. So a club newsletter started in April 1973, publishing five editions on foolscap (8 × 13 inch) paper and finishing with April 1974.\n\nOn the suggestion of Andy Morton, the newsletter grew into Kayak Magazine, sold to several hundred canoeists in Scotland and produced on the new European A4 paper. The production team was Jack, Betty, Gordon and David Cuthill, supported by many other members of Forth Canoe Club and other Scottish clubs. The first edition was published in July 1974 and the magazine ran until 1983.\n\nThese were the days before affordable photocopiers, and of course there were no mobile phones, computers or internet: if you could not get to a competition you had entered, you had to write to the organisers. Betty Cuthill typed the pages on to Roneo waxed silk stencils, and they were reproduced on the dining room table with an electric Gestetner duplicator. Advertising came in from August 1975.\n\nFrom January 1976 a larger A3 cover (420 × 279 mm) allowed photos on the cover, funded by more advertising sponsorship from Lendal Products Ltd (Prestwick), Pyranha Mouldings Ltd (Warrington), Trylon, Tulloch Boat Centre at Canonmills (Edinburgh), Strand Glass, Graham Tiso and Afton Canoes. David Cuthill drew the early covers by scratching the Roneo stencils with a pin; after that he took the photos and developed the black-and-white images. A local printer printed the A3 covers by web-offset lithography.\n\nSearchable copies of every edition are below.', true),
      magazineIssues: field('Kayak Magazine editions (one year per line, linked)', 'Club newsletter\n1973: [April](https://canoeingresults.com/wp-content/uploads/2024/07/197304-Forth-CC-News-Letter-Apr-73.pdf) · [July](https://canoeingresults.com/wp-content/uploads/2024/07/197307-Forth-CC-News-Letter-Jul-73.pdf) · [October](https://canoeingresults.com/wp-content/uploads/2024/07/197310-Forth-CC-News-Letter-Oct-73.pdf)\n1974: [January](https://canoeingresults.com/wp-content/uploads/2024/07/197401-Forth-CC-News-Letter-Jan-74.pdf) · [April](https://canoeingresults.com/wp-content/uploads/2024/07/197404-Forth-CC-News-Letter-Apr-74.pdf)\n\nKayak Magazine\n1974: [July (No. 1)](https://canoeingresults.com/wp-content/uploads/2024/07/197407-Kayak-Magazine-Jul-74.pdf) · [October (No. 2)](https://canoeingresults.com/wp-content/uploads/2024/07/197410-Kayak-Magazine-Oct-74.pdf)\n1975: [January (No. 3)](https://canoeingresults.com/wp-content/uploads/2024/07/197501-Kayak-Magazine-Jan-75.pdf) · [April (No. 4)](https://canoeingresults.com/wp-content/uploads/2024/07/197504-Kayak-Magazine-Apr-75.pdf) · [August (No. 5)](https://canoeingresults.com/wp-content/uploads/2024/07/197508-Kayak-Magazine-Aug-75-V1.pdf) · [October (No. 6)](https://canoeingresults.com/wp-content/uploads/2024/07/197510-Kayak-Magazine-Oct-75.pdf)\n1976: [January (No. 7)](https://canoeingresults.com/wp-content/uploads/2024/07/197601-Kayak-Magazine-Jan-76.pdf) · [May (No. 8)](https://canoeingresults.com/wp-content/uploads/2024/07/197605-Kayak-Magazine-May-76.pdf) · [August (No. 9)](https://canoeingresults.com/wp-content/uploads/2024/07/197608-Kayak-Magazine-Aug-76.pdf) · [November (No. 10)](https://canoeingresults.com/wp-content/uploads/2024/07/197611-Kayak-Magazine-Nov-76.pdf)\n1977: [February (No. 11)](https://canoeingresults.com/wp-content/uploads/2024/07/197702-Kayak-Magazine-Feb-77.pdf) · [May (No. 12)](https://canoeingresults.com/wp-content/uploads/2024/07/197705-Kayak-Magazine-May-77.pdf) · [August (No. 13)](https://canoeingresults.com/wp-content/uploads/2024/07/197708-Kayak-Magazine-Aug-77.pdf) · [November (No. 14)](https://canoeingresults.com/wp-content/uploads/2024/07/197711-Kayak-Magazine-Nov-77.pdf)\n1978: [February (No. 15)](https://canoeingresults.com/wp-content/uploads/2024/07/197802-Kayak-Magazine-Feb-78.pdf) · [May (No. 16)](https://canoeingresults.com/wp-content/uploads/2024/07/197805-Kayak-Magazine-May-78.pdf) · [August (No. 17)](https://canoeingresults.com/wp-content/uploads/2024/07/197808-Kayak-Magazine-Aug-78.pdf) · [November (No. 18)](https://canoeingresults.com/wp-content/uploads/2024/07/197811-Kayak-Magazine-Nov-78-V1.pdf)\n1979: [February (No. 19)](https://canoeingresults.com/wp-content/uploads/2024/07/197902-Kayak-Magazine-Feb-79.pdf) · [May (No. 20)](https://canoeingresults.com/wp-content/uploads/2024/07/197905-Kayak-Magazine-May-79-V1.pdf) · [August (No. 21)](https://canoeingresults.com/wp-content/uploads/2024/07/197908-Kayak-Magazine-Aug-79.pdf) · [November (No. 22)](https://canoeingresults.com/wp-content/uploads/2024/07/197911-Kayak-Magazine-Nov-79.pdf)\n1980: [February (No. 23)](https://canoeingresults.com/wp-content/uploads/2024/07/198002-Kayak-Magazine-Feb-80-V1.pdf) · [May (No. 24)](https://canoeingresults.com/wp-content/uploads/2024/07/198005-Kayak-Magazine-May-80.pdf) · [August (No. 25)](https://canoeingresults.com/wp-content/uploads/2024/07/198008-Kayak-Magazine-Aug-80.pdf) · [November (No. 26)](https://canoeingresults.com/wp-content/uploads/2024/07/198011-Kayak-Magazine-Nov-80.pdf)\n1981: [February (No. 27)](https://canoeingresults.com/wp-content/uploads/2024/07/198102-Kayak-Magazine-Feb-81-V1.pdf) · [May (No. 28)](https://canoeingresults.com/wp-content/uploads/2024/07/198105-Kayak-Magazine-May-81-V1.pdf) · [August (No. 29)](https://canoeingresults.com/wp-content/uploads/2024/07/198108-Kayak-Magazine-Aug-81-V1.pdf) · [November (No. 30)](https://canoeingresults.com/wp-content/uploads/2024/07/198111-Kayak-Magazine-Nov-81.pdf)\n1982: [February (No. 31)](https://canoeingresults.com/wp-content/uploads/2024/07/198202-Kayak-Magazine-Feb-82-V1.pdf) · [May (No. 32)](https://canoeingresults.com/wp-content/uploads/2024/07/198205-Kayak-Magazine-May-82.pdf) · [August (No. 33)](https://canoeingresults.com/wp-content/uploads/2024/07/198208-Kayak-Magazine-Aug-82-V1.pdf) · [November (No. 34)](https://canoeingresults.com/wp-content/uploads/2024/07/198211-Kayak-Magazine-Nov-82.pdf)\n1983: [February (No. 35)](https://canoeingresults.com/wp-content/uploads/2024/07/198302-Kayak-Magazine-Feb-83.pdf) · [May (No. 36)](https://canoeingresults.com/wp-content/uploads/2024/07/198305-Kayak-Magazine-May-83-V1.pdf) · [August (No. 37)](https://canoeingresults.com/wp-content/uploads/2024/07/198308-Kayak-Magazine-Aug-83.pdf) · [November (No. 38)](https://canoeingresults.com/wp-content/uploads/2024/07/198311-Kayak-Magazine-Nov-83.pdf)', true)
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
      timelineUrl: field('Timeline URL', 'https://trello.com/b/4ABvVtTg/fcc-access-project'),
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
      mapUrl: field('Map URL', 'https://maps.app.goo.gl/sXk7kWQrv8EbgwY37'),
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
  saved = saved || {};
  const fields = PAGE_CONTENT[pageId]?.fields || {};
  const copy = Object.fromEntries(Object.entries(fields).map(([key, definition]) => [key, saved[key] ?? definition.value]));
  if (pageId === 'home') {
    const retiredMapUrl = 'https://maps.app.goo.gl/sXk7kWQrv8EbgwY37';
    const clubMapUrl = fields.start1Url.value;
    if (copy.start1Url === retiredMapUrl) {
      copy.start1Url = fields.start1Url.value;
    }
    const link = (text, url) => text ? `[${text}](${String(url).replace(/\(/g, '%28').replace(/\)/g, '%29')})` : '';
    const paragraphs = {
      welcome3Text: `${copy.welcome3} ${link(copy.welcome3Link, '/membership')}${copy.welcome3After}`,
      welcome4Text: `${copy.welcome4Before} ${link(copy.welcome4Link, '/beginners')} ${copy.welcome4After}`,
      welcome5Text: `${copy.welcome5Before} ${link(copy.welcome5Link, '/contact-us')}${copy.welcome5After}`,
      start1Text: `${link(copy.start1Link, copy.start1Url)} ${copy.start1}`,
      start2Text: `${copy.start2Before} ${link(copy.start2Link, '/contact-us')}${copy.start2After}`,
      start5Text: `${copy.start5Before} ${link(copy.start5Link, '/disciplines')}${copy.start5After}`
    };
    for (const [key, value] of Object.entries(paragraphs)) copy[key] = saved[key] ?? value;
    for (const [key, value] of Object.entries(copy)) {
      if (typeof value === 'string') copy[key] = value.replaceAll(retiredMapUrl, clubMapUrl);
    }
  }
  if (pageId === 'membership') copy.memberBody = copy.memberBody.replace(/\bSCA\b/g, 'Paddle Scotland');
  if (pageId === 'access-project' && /^https:\/\/(?:www\.|new\.)?forthcanoeclub\.co\.uk\/access-project\/?$/.test(copy.timelineUrl)) {
    copy.timelineUrl = fields.timelineUrl.value;
  }
  return {
    ...copy,
    ...(pageId === 'home' ? { supporterTiles: getSupporterTiles(saved.supporterTiles, saved.sponsors ?? fields.sponsors.value) } : {}),
    ...(pageId !== 'membership' ? { tileLayout: currentTileLayout(pageId, saved.tileLayout) } : {}),
    ...(BANNER_PAGES.includes(pageId) ? { banner: getBanner(pageId, saved.banner) } : {})
  };
};

export function validatePageFields(pageId, content) {
  const page = PAGE_CONTENT[pageId];
  if (!page || !content || typeof content !== 'object' || Array.isArray(content)) throw new Error('Unknown page or invalid content.');
  const copy = getPageCopy(pageId, content);
  return Object.fromEntries(Object.entries(page.fields).map(([key, definition]) => {
    const value = copy[key];
    if (typeof value !== 'string' || value.length > 20000) throw new Error(`Invalid value for ${definition.label}.`);
    if (/url$/i.test(key)) {
      if (value && !/^https:\/\//i.test(value) && !/^\/(?!\/)/.test(value)) throw new Error(`${definition.label} must be an HTTPS or root-relative URL.`);
    } else {
      validateContentLinks(value);
    }
    return [key, value];
  }));
}
