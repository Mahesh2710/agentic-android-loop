#!/usr/bin/env node

const fs   = require('fs');
const path = require('path');
const glob = require('glob');

const args = process.argv.slice(2);
const targetDir = args[0] || 'app/src/main/java';

// Patterns that indicate hardcoded user-facing strings
const HARDCODED_PATTERNS = [
  // Compose Text()
  /Text\s*\(\s*["']([^"']{3,})["']/g,
  // XML android:text="..."
  /android:text\s*=\s*["']([^@][^"']{2,})["']/g,
  // android:hint="..."
  /android:hint\s*=\s*["']([^@][^"']{2,})["']/g,
  // Button text in Compose
  /text\s*=\s*["']([^"']{3,})["']/g,
  // Toast.makeText
  /makeText\s*\([^,]+,\s*["']([^"']{3,})["']/g,
  // Snackbar.make
  /Snackbar\.make\s*\([^,]+,[^,]+,\s*["']([^"']{3,})["']/g,
];

// Patterns to ignore (not user-facing)
const IGNORE_PATTERNS = [
  /^https?:\/\//,   // URLs
  /^\d+$/,          // Pure numbers
  /^[A-Z_]+$/,      // Constants
  /^#[0-9A-Fa-f]+/, // Hex colors
  /^TAG$/i,         // Log tags
];

function shouldIgnore(str) {
  return IGNORE_PATTERNS.some(p => p.test(str));
}

const files = glob.sync(`${targetDir}/**/*.{kt,xml}`, {
  ignore: ['**/test/**', '**/androidTest/**', '**/build/**']
});

const violations = [];

files.forEach(file => {
  const content = fs.readFileSync(file, 'utf-8');
  const lines   = content.split('\n');

  lines.forEach((line, i) => {
    // Skip comments
    if (line.trim().startsWith('//') || line.trim().startsWith('*')) return;

    HARDCODED_PATTERNS.forEach(pattern => {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(line)) !== null) {
        const str = match[1];
        if (!shouldIgnore(str)) {
          violations.push({
            file: path.relative(process.cwd(), file),
            line: i + 1,
            text: str.substring(0, 60),
            snippet: line.trim().substring(0, 80)
          });
        }
      }
    });
  });
});

const result = {
  passed: violations.length === 0,
  violationCount: violations.length,
  violations
};

console.log(JSON.stringify(result, null, 2));
process.exit(result.passed ? 0 : 1);