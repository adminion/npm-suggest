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

  console.log('compiling list of suggestions for "' + keywords.join (' ') + '"...');

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

      error(err);
      
      if (suggestions.length) {
        listSuggestions();
      } else {
        console.log(`REQUEST_ERROR: Please make sure you are connected to the internet.`);
        process.exit(1);
      }
    }
  });
} 

// query npmsearch.com with the given keywords
function search (next) {

  log('program.keywords', program.keywords);

  let request_url = util.format('%s?q=%s&explain=true&fields=%s&from=%s&size=%s&sort=_score:desc,rating:desc',
    NPM_SEARCH_URL,
    program.keywords.join('%20'),
    FIELDS.join(','),
    (page - 1) * 10,
    program.limit
  );

  log('request_url', request_url);

  let requestOptions = {
    url: request_url,
    timeout: 10000 // 10 seconds
  }

  request(requestOptions, function (err, response, body) {

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

  if (page > 1) {
    let prevPage = page - 1;
    let from = prevPage * 10 - 9;
    let to = prevPage * 10;

    choices[choices.length] = {
      name: `Prev page: ${prevPage} (${from} - ${to})`,
      value: 'prev',
      short: 'prev'
    }
  }

  choices[choices.length] = {
    name: util.format('Next page: %s (%s - %s)',
      page + 1,
      ((page + 1) * 10) - 9,
      (page + 1) * 10
    ),
    value: 'next',
    short: 'previous'
  }

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


  let question = {
    name: 'inspect',
    type: 'list',
    choices: choices,
    message: util.format('suggestions for "%s" Page %s (%s - %s)', 
      program.keywords.join(' '),
      page,
      page * 10 - 9,
      page * 10
    )
  }

  clear();

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

    log('answers.search', answers.search);

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
      case 'next':    page+=1;
                      clear();
                      main(program.keywords);
                      break;

      case 'prev':    page-=1;
                      clear();
                      main(program.keywords);
                      break;

      case 'search':  searchPrompt();
                      break;

      case 'exit':    clear();
                      process.exit();
                      break;

      default:        clear();
                      listSuggestions();
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
