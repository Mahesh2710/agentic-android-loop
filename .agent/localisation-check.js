#!/usr/bin/env node

const fs   = require('fs');
const path = require('path');
const glob = require('glob');

const agentrc   = JSON.parse(fs.readFileSync('.agentrc', 'utf-8'));
const languages = agentrc.languages || ['en'];
const resRoot   = agentrc.project.resRoot || 'app/src/main/res';

function parseStringKeys(filePath) {
  if (!fs.existsSync(filePath)) return new Set();
  const content = fs.readFileSync(filePath, 'utf-8');
  const keys    = new Set();
  const regex   = /<string\s+name="([^"]+)"/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    keys.add(match[1]);
  }
  return keys;
}

const baseFile = path.join(resRoot, 'values', 'strings.xml');
const baseKeys = parseStringKeys(baseFile);

const results = {};
const missing = {};
let allPassed = true;

languages.forEach(lang => {
  if (lang === 'en') return;
  const langFile = path.join(resRoot, `values-${lang}`, 'strings.xml');
  const langKeys = parseStringKeys(langFile);
  const missingKeys = [...baseKeys].filter(k => !langKeys.has(k));

  results[lang] = {
    total: baseKeys.size,
    present: langKeys.size,
    missing: missingKeys.length,
    missingKeys
  };

  if (missingKeys.length > 0) {
    allPassed = false;
    missing[lang] = missingKeys;
  }
});

const output = {
  passed: allPassed,
  baseLanguage: 'en',
  totalBaseKeys: baseKeys.size,
  languages: results,
  missingByLanguage: missing
};

console.log(JSON.stringify(output, null, 2));
process.exit(allPassed ? 0 : 1);