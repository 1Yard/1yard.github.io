// 1Yard portal settings. This is the only file you need to edit to configure the site.
// The Supabase URL and publishable/anon key are meant to be public — the database
// access rules protect the data. NEVER put the "service_role" / secret key here.
window.ONEYARD_CONFIG = {
  supabaseUrl: "https://ybjaifvfgparclbeliue.supabase.co",
  supabaseAnonKey: "sb_publishable_Gj6l_Yw-E8-2NrcHEud1SQ_QMOb9ILE",

  officePhone: "416-431-0010",   // shown to clients

  // Training shown to approved volunteers (Google Docs, shared as "anyone with the link can view").
  training: [
    { title: "1Yard Volunteer Training Guide", detail: "Reading · who we help, safety, how we work", url: "https://docs.google.com/document/d/1-PiXDLIz6gtsuk2sfu-0NeOiwQbfiVJLLkLSxutZjYU/edit?usp=sharing" },
    { title: "1Yard Volunteer Guide: How a Job Works", detail: "Reading · 15 min · the website, step by step", url: "https://docs.google.com/document/d/1VZrind-ymBFs_WDUi9x-KzeMlm5g_DTjVSRE_FHIUio/edit?usp=sharing" },
  ],
  // Volunteer waiver. This link downloads the Google Doc as a PDF.
  waiverUrl: "https://docs.google.com/document/d/1xgABuq3XIzky6raWa2_RcJKEglkLsQjTCNl8ZlKfXPo/export?format=pdf",
};
