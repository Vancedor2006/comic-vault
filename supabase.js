/* ==========================================================================
   ComicVault - Supabase Client Setup
   ========================================================================== */

const SUPABASE_URL = "https://drdcypmwpfehwvgtwepy.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRyZGN5cG13cGZlaHd2Z3R3ZXB5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA4NzA5OTEsImV4cCI6MjEwNjQ0Njk5MX0.TVbVlv7xf63KmjyCa5Gj0DDki1Jv_KWvwX-z98wircY";

// Create database client safely on global window
window.supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);