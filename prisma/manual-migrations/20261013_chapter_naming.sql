-- Customizable chapter naming: [Type] [Number] - [Name], with a short summary and optional description.
ALTER TABLE "Course" ADD COLUMN IF NOT EXISTS "chapterType" TEXT NOT NULL DEFAULT 'Chapter';

CREATE TABLE IF NOT EXISTS "ChapterInfo" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "type" TEXT NOT NULL DEFAULT 'Chapter',
  "number" INTEGER NOT NULL,
  "name" TEXT NOT NULL,
  "summary" TEXT NOT NULL DEFAULT '',
  "description" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "ChapterInfo_type_number_key" ON "ChapterInfo"("type", "number");

-- The eight chapter names that used to be hardcoded in the app. Now they are ordinary, editable rows.
INSERT INTO "ChapterInfo" ("type", "number", "name", "summary", "description") VALUES
 ('Chapter', 1, 'Electric Current & Ohm''s Law', 'DC Circuits & Kirchhoff''s Laws', 'Electric current intensity, potential difference, Ohm''s law, resistance, and Kirchhoff''s laws.'),
 ('Chapter', 2, 'Magnetic Effects of Electric Current', 'Magnetic Force & Torque', 'Magnetic flux, straight wires, circular coils, solenoids, magnetic force, torque, and measuring instruments.'),
 ('Chapter', 3, 'Electromagnetic Induction', 'Faraday''s Law & Transformers', 'Faraday''s law, Lenz''s rule, mutual and self induction, AC generators (dynamos), and electrical transformers.'),
 ('Chapter', 4, 'Alternating Current Circuits', 'RLC & Resonant Circuits', 'AC source with resistors, inductors, capacitors, RLC circuits, and resonant circuits.'),
 ('Chapter', 5, 'Duality of Wave and Particle', 'Photons & Photoelectric Effect', 'Blackbody radiation, photoelectric effect, Compton effect, and de Broglie matter waves.'),
 ('Chapter', 6, 'Atomic Spectra', 'Bohr Model & X-Rays', 'Bohr''s hydrogen atom model, emission and absorption spectra, and X-rays production.'),
 ('Chapter', 7, 'Lasers', 'Coherent Light & Laser Principles', 'Stimulated and spontaneous emission, laser production principles, and Helium-Neon laser applications.'),
 ('Chapter', 8, 'Modern Electronics', 'Semiconductors & Logic Gates', 'Semiconductors, p-n junction diodes, transistors, logic gates, and digital electronics.')
ON CONFLICT ("type", "number") DO NOTHING;
