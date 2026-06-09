import en from "./en";
import hi from "./hi";

const faqKpis = {
  en: [
  
  
    {
      title: "Operator Efficiency",
      formula:
        "((Machine Runtime + Loading & Unloading Time + Sum of all Downtime Reason except Idle Time, Minor Stoppages, Late Start & Early Stop) / (Total Available Time - Breaks)) * 100",
      note:
        "Use this when the production team wants an operator-focused performance view.",
    },
    {
      title: "Division Utilization (Plant, Division, Line)",
      formula:
        "((Machine Runtime + Loading & Unloading Time) / (Total Available Time - Breaks)) * 100",
      note:
        "This is the roll-up version of utilization across machine, line, division, or plant summaries.",
    },
    {
      title: "OEE (Used in Traceability Dashboard)",
      formula: "OEE = Availability × Performance × Quality",
      note:
        "In this system: Availability = Runtime / Planned Production Time, Performance = (Ideal Cycle Time × Total Count) / Runtime, Quality = OK Count / Total Count.",
    },
    {
      title: "OA (Used in Traceability Dashboard)",
      formula: "OA = Runtime / (Runtime + Downtime)",
      note:
        "This is the current Traceability OA logic used in dashboard cards and OA analysis.",
    },
    {
      title: "Cycle Time Ratio (CT Ratio)",
      formula: "Actual Cycle Time / Planned Cycle Time",
      note:
        "Useful for comparing actual operating speed against the planned machine cycle standard.",
    },
    
    
   
    {
      title: "Target Production (Used in Traceability Metrics)",
      formula:
        "Target Production = floor((Shift Duration - Planned Break - Planned Downtime) / Effective Cycle Time)",
      note: "Effective Cycle Time in this system = Standard Cycle Time + Loading Time.",
    },
    {
      title: "Downtime (Used in Traceability OEE/OA)",
      formula:
        "Downtime = Sum of scan gaps greater than 5 minutes between consecutive production logs",
      note:
        "The current system derives downtime from production-log scan gaps instead of a manual downtime sheet.",
    },
  ],
  hi: [
    
    
    {
      title: "ऑपरेटर एफिशिएंसी",
      formula:
        "((Machine Runtime + Loading & Unloading Time + Sum of all Downtime Reason except Idle Time, Minor Stoppages, Late Start & Early Stop) / (Total Available Time - Breaks)) * 100",
      note: "यह view ऑपरेटर के handling और performance पर ज़्यादा focus करता है।",
    },
    {
      title: "डिवीजन यूटिलाइजेशन (प्लांट, डिवीजन, लाइन)",
      formula:
        "((Machine Runtime + Loading & Unloading Time) / (Total Available Time - Breaks)) * 100",
      note:
        "उसी utilization logic को machine, line, division या plant level पर roll-up करके दिखाया जा सकता है।",
    },
    {
      title: "OEE (ट्रेसबिलिटी डैशबोर्ड में उपयोग)",
      formula: "OEE = Availability × Performance × Quality",
      note:
        "इस सिस्टम में: Availability = Runtime / Planned Production Time, Performance = (Ideal Cycle Time × Total Count) / Runtime, Quality = OK Count / Total Count.",
    },
    {
      title: "OA (ट्रेसबिलिटी डैशबोर्ड में उपयोग)",
      formula: "OA = Runtime / (Runtime + Downtime)",
      note:
        "यह वर्तमान Traceability OA logic है जो dashboard card और OA analysis में उपयोग होती है।",
    },
    {
      title: "साइकिल टाइम रेशियो (CT Ratio)",
      formula: "Actual Cycle Time / Planned Cycle Time",
      note:
        "यह actual speed को planned machine cycle standard के साथ compare करने के लिए उपयोगी है।",
    },
  
  
    
    {
      title: "टारगेट प्रोडक्शन (ट्रेसबिलिटी मेट्रिक्स में उपयोग)",
      formula:
        "Target Production = floor((Shift Duration - Planned Break - Planned Downtime) / Effective Cycle Time)",
      note: "इस सिस्टम में Effective Cycle Time = Standard Cycle Time + Loading Time.",
    },
    {
      title: "डाउनटाइम (ट्रेसबिलिटी OEE/OA में उपयोग)",
      formula:
        "Downtime = Sum of scan gaps greater than 5 minutes between consecutive production logs",
      note:
        "वर्तमान सिस्टम manual downtime sheet के बजाय production log scan gap से downtime निकालता है।",
    },
  ],
};

const faqRejections = {
  en: [
    {
      title: "CR - Casting Defects",
      items: [
        "Warm Up", "Non-Filling", "Pre Filling", "Cold Shot", "Crack", "Chip-off", "Shrinkage",
        "Ejector Pin Deep", "Bend", "Black Mark", "Dent", "Extra Metal", "Runner Broken",
        "Excess Fettling", "Flow Mark", "Soldering", "Catching", "White-Rust", "Peel Off",
        "Casting Damage", "Biscuit Thickness NG", "Cast Pressure NG", "Air Bubble",
        "Core Pin Broken", "Core Pin Bend", "Under Cut", "Gate Broken", "Laser Marking NG",
      ],
    },
    {
      title: "CRAM - Cram Defects",
      items: [
        "Blow Hole", "Blow Hole M14", "LT Oil Gallery-1 NG", "LT Oil Gallery-2 NG", "Body Leak",
        "Bend", "Chipoff", "Cold Shut", "Crack", "Blister", "Iron Particle", "Non-filling",
        "Porosity", "Black Mark", "Ejector Pin Depression", "Casting Damage", "Shrinkage",
        "Peel-off", "Flow Mark", "Scratch Mark", "Laser Marking NG", "Setting part",
        "Over Fettling", "Tool Broken", "Power Failure Part", "Unclean", "Dent",
        "Oval/Soldering", "Overcut", "Bubble",
      ],
    },
    {
      title: "MR - MR Defects",
      items: [
        "Dia Over Size", "Dia Under Size", "Chattering", "Toolmark", "Dent", "Dimension NG",
        "Tapping NG", "Setting Part", "Power Cut", "Air Pressure Low", "Machine Alarm",
        "Laser Marking NG", "Extra Rework", "Roughness NG", "Chamfer NG", "Profile NG",
        "Position NG", "Receiving Gauge NG", "Step Mark", "Scratch Mark",
      ],
    },
  ],
  hi: [
    {
      title: "CR - कास्टिंग दोष",
      items: [
        "वार्मअप", "नॉन-फिलिंग", "प्री फिलिंग", "कोल्ड शॉट", "क्रैक", "चिप-ऑफ", "श्रीनकेज",
        "इजेक्टर पिन डीप", "बेंड", "ब्लैक मार्क", "डेंट", "एक्स्ट्रा मेटल", "रनर टूटा हुआ",
        "अतिरिक्त फेटलिंग", "फ्लो मार्क", "सोल्डरिंग", "कैचिंग", "व्हाइट-रस्ट", "पील ऑफ",
        "कास्टिंग डैमेज", "बिस्किट थिकनेस NG", "कास्ट प्रेशर NG", "एयर बबल",
        "कोर पिन टूटा", "कोर पिन बेंड", "अंडर कट", "गेट टूटा", "लेजर मार्किंग NG",
      ],
    },
    {
      title: "CRAM - क्रैम दोष",
      items: [
        "ब्लो होल", "ब्लो होल M14", "LT ऑयल गैलरी-1 NG", "LT ऑयल गैलरी-2 NG", "बॉडी लीक",
        "बेंड", "चिपऑफ", "कोल्ड शट", "क्रैक", "ब्लिस्टर", "आयरन पार्टिकल", "नॉन-फिलिंग",
        "पोरोसिटी", "ब्लैक मार्क", "इजेक्टर पिन डिप्रेशन", "कास्टिंग डैमेज", "श्रीनकेज",
        "पील-ऑफ", "फ्लो मार्क", "स्क्रैच मार्क", "लेजर मार्किंग NG", "सेटिंग पार्ट",
        "ओवर फेटलिंग", "टूल टूटा", "पावर फेलियर पार्ट", "गंदा", "डेंट",
        "ओवल/सोल्डरिंग", "ओवरकट", "बबल",
      ],
    },
    {
      title: "MR - MR दोष",
      items: [
        "डायामीटर ओवर साइज", "डायामीटर अंडर साइज", "चैटरिंग", "टूलमार्क", "डेंट", "डाइमेंशन NG",
        "टैपिंग NG", "सेटिंग पार्ट", "पावर कट", "एयर प्रेशर कम", "मशीन अलर्ट",
        "लेजर मार्किंग NG", "एक्स्ट्रा रीवर्क", "रफनेस NG", "चैम्फर NG", "प्रोफाइल NG",
        "पोजीशन NG", "रिसीविंग गेज NG", "स्टेप मार्क", "स्क्रैच मार्क",
      ],
    },
  ],
};

export const translations = {
  en: { ...en, faq: { ...en.faq, kpis: faqKpis.en, rejections: faqRejections.en } },
  hi: { ...hi, faq: { ...hi.faq, kpis: faqKpis.hi, rejections: faqRejections.hi } },
};
