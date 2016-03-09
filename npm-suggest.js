#!/usr/bin/node

"use strict";

const util = require('util');

const pkg = require('./package');

const async = require('async');
const clear = require('clear');
const debug = require('debug');
const inquirer = require('inquirer');
const moment = require('moment');
const program = require('commander');
const request = require('request'); 

const log = debug('npm-suggest');
const error = debug('npm-suggest:error');

const NPM_SEARCH_URL = 'http://npmsearch.com/query';
const SUGGESTION_LIMIT = 10;
const FIELDS = [
  'name', 
  'description', 
  'author', 
  'version', 
  'rating', 
  'maintainers', 
  'created', 
  'modified',
  'readme',
  'homepage',
  'dependencies',
  'devDependencies',
  'keywords',
  'scripts'
];

let page = 1;
let results = [];
let suggestions = [];

console.log('compiling list of suggestions for "' + process.argv.slice(2).join (' ') + '"...');

// setup our CLI program
program
  .version(pkg.version)
  .description(pkg.description)
  .usage('[options] [keywords...]')
  .arguments('[keywords...]')
  .option('-l, --limit <n>', 
    `Limit the number of suggestions returned. Default: ${SUGGESTION_LIMIT}`, 
    parseInt, 
    SUGGESTION_LIMIT
  )
  .action(main);

// tell our program to parse CLI arguments
program.parse(process.argv);

// if no arguments are passed, output the help message
if (!program.args.length) {
  return program.outputHelp();
}

// main function
function main (keywords) {

  log('keywords',keywords);

  keywords = keywords || []; 

  program.keywords = keywords;

  let steps = [
    search,
    digestResults,
    listSuggestions
  ];
  
  async.series(steps, (err) => {
    if (err) {
      return error(err);
    }
  });
} 

// query npmsearch.com with the given keywords
function search (next) {

  log('program.keywords', program.keywords);

  let request_url = util.format('%s?q=%s&fields=%s&size=%s&sort=rating:desc',
    NPM_SEARCH_URL,
    program.keywords.join('%20'),
    FIELDS.join(','),
    program.limit
  );

  request(request_url, function (err, response, body) {

    if (err) {
      next(err);
    } else if (response.statusCode != 200) {
      next('error: received non-200 status code: ' + response.statusCode);
    } else {
      
      body = JSON.parse(body);

      results = body.results;

      log('results', JSON.stringify(results, null, 2));

      next();
    }
  });
}

function digestResults (next) {


  for (let i = 0; i < results.length; i+=1) {
    suggestions[i] = {};

    for (let key in results[i]) {
      if (key === 'dependencies' || key === 'devDependencies' || key === 'keywords') {

        log('results[%s][%s]: %j', i, key, results[i][key]);

        suggestions[i][key] = [];

        for (let j = 0; j < results[i][key].length; j+= 1) {
          suggestions[i][key][j] = results[i][key][j];
        }
      } else {
        suggestions[i][key] = results[i][key][0];
      }
    }
  }

  log('suggestions', suggestions);

  // run if defined
  next && next();

}

function listSuggestions (next) {

  let choices = [new inquirer.Separator(listHeaders())];

  for (let i = 0; i < suggestions.length; i+=1) {
    let suggestion = suggestions[i];

    choices[choices.length] = {
      name: formatChoice(i),
      value: i,
      short: suggestion.name
    };
  }

  choices[choices.length] = new inquirer.Separator();

  choices[choices.length] = {
    name: 'Search Again',
    value: 'search',
    short: 'search'
  };

  choices[choices.length] = {
    name: 'Exit',
    value: 'exit', 
    short: 'exit'
  };

  choices[choices.length] = new inquirer.Separator();

  log('choices', choices);

  clear();

  let question = {
    name: 'inspect',
    type: 'list',
    choices: choices,
    message: 'suggestions for "' + program.keywords.join(' ') + '" (press "enter" to inspect):'
  }


  prompt(question, function (answers) {

    // display the package info

    log('answers', answers);

    parseInput(answers.inspect);
  });

  // run if defined
  next && next();

}

function prompt (question, callback) {

  inquirer.prompt([question], callback);
}

function searchPrompt () {
  let question = {
    name: 'search',
    message: 'search'
  }

  clear();

  prompt(question, function (answers) {
    main(answers.search.split(' '));
  });

}

function continuePrompt () {
  let question = {
    name: 'continue',
    value: 'continue',
    message: 'press "enter" to return to suggestions...'
  };

  prompt(question, () => {
    clear();
    listSuggestions();
  });
}


function parseInput (input) {

  log('input', input);

  if ('string' === typeof input) {
    switch (input) {
      case 'search':  searchPrompt();
                      break;

      case 'exit':    clear();
                      process.exit();
                      break;
    }
  } else {
    clear();
    inspect(input);
  }
}

function listHeaders () {
  // two spaces at beginning are intentional

  let header = util.format('RATING%sNAME%sVERSION%sDESCRIPTION',
    ' '.repeat(8),
    ' '.repeat(20),
    ' '.repeat(9)
    );

  if (header.length > (process.stdout.columns - 3 ) ) {
    header = header.substring(0, process.stdout.columns - 2);
  }

  return header;
}

function formatChoice (i) {

  log('formatChoice i', i);

  let suggestion = suggestions[i];

  let displayRating = (Number(suggestion.rating) < 10) 
    ? ' ' + suggestion.rating.toFixed(2) 
    : suggestion.rating.toFixed(2);

  let displayName = (suggestion.name.length > 23)
      ? suggestion.name.substr(0, 20) + '...'
      : suggestion.name;

  let suggestion_str = [
    displayRating,
    ' '.repeat('9'),
    displayName,
    ' '.repeat(24 - displayName.length),
    suggestion.version,
    ' '.repeat(16 - String(suggestion.version).length),
    suggestion.description
  ].join('');

  if (suggestion_str.length > (process.stdout.columns - 2 ) ) {
    suggestion_str = suggestion_str.substr(0, process.stdout.columns - 3);
  }

  log('suggestion_str', suggestion_str);

  return suggestion_str;
}

function inspect (i) {

  log('inspect i', i);

  let suggestion = suggestions[i];
  console.log(`
  rating:           ${suggestion.rating}
  name:             ${suggestion.name}
  description:      ${suggestion.description}
  author:           ${suggestion.author}
  maintainers:      ${suggestion.maintainers}
  version:          ${suggestion.version}
  created:          ${moment(suggestion.created).fromNow()}
  modified:         ${moment(suggestion.modified).fromNow()}
  homepage:         ${suggestion.homepage}
  dependencies:     ${suggestion.dependencies}
  devDependencies:  ${suggestion.devDependencies}
  keywords:         ${suggestion.keywords}
  
`);

  continuePrompt();
}
