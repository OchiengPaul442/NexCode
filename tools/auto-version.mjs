#!/usr/bin/env node

/**
 * Auto-version and changelog generator for NexCode
 * 
 * Usage: node tools/auto-version.mjs
 * 
 * Analyzes git commits since last version tag and:
 * 1. Determines version bump type (major/minor/patch)
 * 2. Updates package.json version
 * 3. Generates changelog entries from commits
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';
import { join } from 'path';

const ROOT_DIR = join(import.meta.dirname, '..');
const EXTENSION_DIR = join(ROOT_DIR, 'extension');
const PACKAGE_JSON = join(EXTENSION_DIR, 'package.json');
const CHANGELOG_MD = join(EXTENSION_DIR, 'CHANGELOG.md');

function exec(cmd) {
  return execSync(cmd, { cwd: ROOT_DIR, encoding: 'utf-8' }).trim();
}

function getCurrentVersion() {
  const pkg = JSON.parse(readFileSync(PACKAGE_JSON, 'utf-8'));
  return pkg.version;
}

function getLastVersionTag() {
  try {
    // Try git describe first
    const tag = exec('git describe --tags --abbrev=0');
    if (tag && tag.startsWith('v')) return tag;
  } catch {}
  
  try {
    // Fallback: get the most recent tag
    const tag = exec('git tag -l "v*" --sort=-version:refname | head -1');
    if (tag && tag.startsWith('v')) return tag;
  } catch {}
  
  return null;
}

function getCommitsSinceTag(tag) {
  const range = tag ? `${tag}..HEAD` : 'HEAD';
  let log;
  try {
    log = exec(`git log ${range} --pretty=format:"%h|%s|%an" --no-merges`);
  } catch {
    return [];
  }
  
  if (!log || !log.trim()) return [];
  
  return log.split('\n').filter(line => line && line.includes('|')).map(line => {
    const parts = line.split('|');
    return {
      hash: parts[0]?.trim() || '',
      message: parts[1]?.trim() || '',
      author: parts[2]?.trim() || ''
    };
  }).filter(c => c.message);
}

function categorizeCommits(commits) {
  const categories = {
    breaking: [],
    features: [],
    fixes: [],
    security: [],
    performance: [],
    docs: [],
    other: []
  };

  for (const commit of commits) {
    const msg = commit.message.toLowerCase();
    
    if (msg.includes('breaking') || msg.includes('!:')) {
      categories.breaking.push(commit);
    } else if (msg.startsWith('feat') || msg.startsWith('add') || msg.includes('implement')) {
      categories.features.push(commit);
    } else if (msg.startsWith('fix') || msg.includes('bug') || msg.includes('patch')) {
      categories.fixes.push(commit);
    } else if (msg.includes('security') || msg.includes('vulnerability') || msg.includes('cve')) {
      categories.security.push(commit);
    } else if (msg.includes('perf') || msg.includes('optimize') || msg.includes('speed')) {
      categories.performance.push(commit);
    } else if (msg.startsWith('docs') || msg.includes('readme') || msg.includes('changelog')) {
      categories.docs.push(commit);
    } else {
      categories.other.push(commit);
    }
  }

  return categories;
}

function determineBumpType(categories) {
  if (categories.breaking.length > 0) return 'major';
  if (categories.features.length > 0) return 'minor';
  return 'patch';
}

function bumpVersion(version, bumpType) {
  const [major, minor, patch] = version.split('.').map(Number);
  
  switch (bumpType) {
    case 'major': return `${major + 1}.0.0`;
    case 'minor': return `${major}.${minor + 1}.0`;
    case 'patch': return `${major}.${minor}.${patch + 1}`;
    default: return version;
  }
}

function generateChangelogEntry(newVersion, categories, tag) {
  const date = new Date().toISOString().split('T')[0];
  const lines = [`## ${newVersion}`, '', `**Date:** ${date}`];
  
  if (tag) {
    lines.push(`**Previous version:** ${tag.replace('v', '')}`);
  }
  
  lines.push('');

  if (categories.breaking.length > 0) {
    lines.push('### Breaking Changes');
    for (const c of categories.breaking) {
      lines.push(`- ${c.message} (${c.hash})`);
    }
    lines.push('');
  }

  if (categories.features.length > 0) {
    lines.push('### Features');
    for (const c of categories.features) {
      lines.push(`- ${c.message} (${c.hash})`);
    }
    lines.push('');
  }

  if (categories.fixes.length > 0) {
    lines.push('### Bug Fixes');
    for (const c of categories.fixes) {
      lines.push(`- ${c.message} (${c.hash})`);
    }
    lines.push('');
  }

  if (categories.security.length > 0) {
    lines.push('### Security');
    for (const c of categories.security) {
      lines.push(`- ${c.message} (${c.hash})`);
    }
    lines.push('');
  }

  if (categories.performance.length > 0) {
    lines.push('### Performance');
    for (const c of categories.performance) {
      lines.push(`- ${c.message} (${c.hash})`);
    }
    lines.push('');
  }

  if (categories.docs.length > 0) {
    lines.push('### Documentation');
    for (const c of categories.docs) {
      lines.push(`- ${c.message} (${c.hash})`);
    }
    lines.push('');
  }

  if (categories.other.length > 0) {
    lines.push('### Other Changes');
    for (const c of categories.other) {
      lines.push(`- ${c.message} (${c.hash})`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

function updateChangelog(newEntry) {
  let content = '';
  if (existsSync(CHANGELOG_MD)) {
    content = readFileSync(CHANGELOG_MD, 'utf-8');
  } else {
    content = '# Changelog\n';
  }

  // Insert new entry after the header
  const headerEnd = content.indexOf('\n\n');
  if (headerEnd === -1) {
    content = content + '\n' + newEntry;
  } else {
    content = content.slice(0, headerEnd + 2) + newEntry + content.slice(headerEnd + 2);
  }

  writeFileSync(CHANGELOG_MD, content);
}

function updatePackageVersion(newVersion) {
  const pkg = JSON.parse(readFileSync(PACKAGE_JSON, 'utf-8'));
  pkg.version = newVersion;
  writeFileSync(PACKAGE_JSON, JSON.stringify(pkg, null, 2) + '\n');
}

function createVersionTag(newVersion) {
  try {
    exec(`git tag v${newVersion}`);
    console.log(`Created tag: v${newVersion}`);
  } catch (e) {
    console.warn(`Warning: Could not create tag: ${e.message}`);
  }
}

// Main
console.log('🔍 Analyzing commits...\n');

const currentVersion = getCurrentVersion();
console.log(`Current version: ${currentVersion}`);

const lastTag = getLastVersionTag();
console.log(`Last tag: ${lastTag || '(none)'}`);

const commits = getCommitsSinceTag(lastTag);
console.log(`Commits since last tag: ${commits.length}`);

if (commits.length === 0) {
  console.log('\n✅ No new commits to version.');
  process.exit(0);
}

const categories = categorizeCommits(commits);
const bumpType = determineBumpType(categories);
const newVersion = bumpVersion(currentVersion, bumpType);

console.log(`\n📊 Commit breakdown:`);
console.log(`   Breaking: ${categories.breaking.length}`);
console.log(`   Features: ${categories.features.length}`);
console.log(`   Fixes: ${categories.fixes.length}`);
console.log(`   Security: ${categories.security.length}`);
console.log(`   Performance: ${categories.performance.length}`);
console.log(`   Docs: ${categories.docs.length}`);
console.log(`   Other: ${categories.other.length}`);

console.log(`\n📦 Version bump: ${currentVersion} → ${newVersion} (${bumpType})`);

// Update files
updatePackageVersion(newVersion);
console.log('✅ Updated package.json');

const changelogEntry = generateChangelogEntry(newVersion, categories, lastTag);
updateChangelog(changelogEntry);
console.log('✅ Updated CHANGELOG.md');

// Create git tag
createVersionTag(newVersion);

console.log(`\n🎉 Version ${newVersion} ready! Run 'npm run build' to package.`);
