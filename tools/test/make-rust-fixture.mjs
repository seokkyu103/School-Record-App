#!/usr/bin/env node
// Rust 시험(src-tauri/src/tests/grade_setup_fixture_tests.rs)이 여는 고정 파일을 다시 만든다.
// 가짜 자료(1학년 3반 25명)로 grade-setup과 같은 함수를 부른다. 도구나 schema.sql이 바뀌면 다시 돌린다.
//   node tools/test/make-rust-fixture.mjs
// 확장자를 .sqlite로 두는 것은 .gitignore가 *.db를 막기 때문이다(실제 반 파일이 실수로 올라가지 않게).
import fs from 'node:fs'
import path from 'node:path'
import {buildClassFile, loadAppSchema, normalizeConfig} from '../grade-setup/grade-setup.mjs'
import {REPO_ROOT} from '../lib/common.mjs'
import {SETUP_CONFIG, fakeStudents, tempDir, writeScanList} from './fixtures.mjs'

const target = path.join(REPO_ROOT, 'src-tauri', 'src', 'tests', 'fixtures', 'grade-setup-1-3.sqlite')
const work = tempDir('fixture')
try {
  writeScanList(path.join(work, 'scan.json'))
  const config = normalizeConfig(SETUP_CONFIG, work)
  const tmp = path.join(work, 'class.db')
  buildClassFile(tmp, {students: fakeStudents(1, [3], 25), config, app: loadAppSchema()})
  fs.mkdirSync(path.dirname(target), {recursive: true})
  fs.copyFileSync(tmp, target)
  console.log('만듦: ' + path.relative(REPO_ROOT, target))
} finally {
  fs.rmSync(work, {recursive: true, force: true})
}
