// 1Yard portal settings. This is the only file you need to edit to configure the site.
// The Supabase URL and publishable/anon key are meant to be public — the database
// access rules protect the data. NEVER put the "service_role" / secret key here.
window.ONEYARD_CONFIG = {
  supabaseUrl: "https://ybjaifvfgparclbeliue.supabase.co",
  supabaseAnonKey: "sb_publishable_Gj6l_Yw-E8-2NrcHEud1SQ_QMOb9ILE",

  officePhone: "416-431-0010",   // shown to clients

  // Training shown to approved volunteers. Swap in real links (YouTube, Google Drive, etc.).
  training: [
    { title: "Welcome to 1Yard", detail: "Video · 10 min", url: "https://example.com/1yard/training/welcome" },
    { title: "Safety outdoors: tools, lifting, weather", detail: "Reading · 10 min", url: "https://example.com/1yard/training/safety" },
    { title: "Working with clients", detail: "Video · 12 min", url: "https://example.com/1yard/training/clients" },
    { title: "Fall services how-to", detail: "Video · 8 min", url: "https://example.com/1yard/training/fall" },
  ],
  // Put the blank waiver PDF in the docs/ folder as waiver.pdf, or paste a link to it here.
  waiverUrl: "waiver.pdf",
};
