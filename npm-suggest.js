#!/usr/bin/env node

"use strict";

const child_process = require('child_process')
const fs = require('fs')
const util = require('util')

const pkg = require('./package')

const async = require('async')
const clearScreen = require('clear')
const debug = require('debug')
const inquirer = require('inquirer')
const moment = require('moment')
const open = require('open')
const program = require('commander')
const request = require('request') 
const shortid = require('shortid')

const log = debug(pkg.name)
log.debug = debug(`${pkg.name}:debug`)
log.err = debug(`${pkg.name}:err`)
log.info = debug(`${pkg.name}:info`)
log.warn = debug(`${pkg.name}:warn`)

const NPM_SEARCH_URL = 'http://npmsearch.com/query'
const SUGGESTION_LIMIT = 10
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
  'repository',
  'homepage',
  'dependencies',
  'devDependencies',
  'keywords',
  'scripts'
]

let page = 1
let results = []
let suggestions = []

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
  .action(main)

// tell our program to parse CLI arguments
program.parse(process.argv)

// if no arguments are passed, output the help message
if (!program.args.length) {
  return program.outputHelp()
}

// main function
function main (keywords) {

  console.log('compiling list of suggestions for "' + keywords.join (' ') + '"...')

  log.info('keywords',keywords)

  keywords = keywords || [] 

  program.keywords = keywords

  let steps = [
    search,
    digestResults,
    listSuggestions
  ]
  
  async.series(steps, (err) => {
    if (err) {

      log.err(err)
      
      if (suggestions.length) {
        listSuggestions()
      } else {
        console.log(`REQUEST_ERROR: Please make sure you are connected to the internet.`)
        process.exit(1)
      }
    }
  })
} 

// query npmsearch.com with the given keywords
function search (next) {

  log.debug('program.keywords', program.keywords)

  let request_url = util.format('%s?q=%s&explain=true&fields=%s&from=%s&size=%s',
    NPM_SEARCH_URL,
    program.keywords.join('%20'),
    FIELDS.join(','),
    (page - 1) * 10,
    program.limit
  )

  log.info('request_url', request_url)

  let requestOptions = {
    url: request_url,
    timeout: 10000 // 10 seconds
  }

  request(requestOptions, function (err, response, body) {

    if (err) {
      next(err)
    } else if (response.statusCode != 200) {
      next('error: received non-200 status code: ' + response.statusCode)
    } else {
      
      body = JSON.parse(body)

      results = body.results

      log.debug('results', JSON.stringify(results, null, 2))

      next()
    }
  })
}

function digestResults (next) {

  for (let i = 0; i < results.length; i+=1) {
    suggestions[i] = {}

    for (let key in results[i]) {
      if (key === 'dependencies' || key === 'devDependencies' || key === 'keywords') {

        log.debug('results[%s][%s]: %j', i, key, results[i][key])

        suggestions[i][key] = []

        for (let j = 0; j < results[i][key].length; j+= 1) {
          suggestions[i][key][j] = results[i][key][j]
        }
      } else {
        suggestions[i][key] = results[i][key][0]
      }
    }
  }

  log.debug('suggestions', suggestions)

  // run if defined
  next && next()

}

function listSuggestions (next) {

  let choices = []

  // add a separator with the current page information
  choices[choices.length] = new inquirer.Separator(
    util.format('Suggestions for "%s" Page %s (%s - %s):',
      program.keywords.join(' '),
      page,
      page * 10 - 9,
      page * 10
    )
  )

  // add a separator with column headers
  choices[choices.length] = new inquirer.Separator(listHeaders())

  // add each suggestion
  for (let i = 0; i < suggestions.length; i+=1) {
    let pkg = suggestions[i]

    choices[choices.length] = {
      name: formatChoice(pkg),
      value: pkg,
      short: pkg.name
    }
  }

  // add a default separator
  choices[choices.length] = new inquirer.Separator()

  // if we are on page two or greater, add a previous page choice
  if (page > 1) {
    let prevPage = page - 1
    let from = prevPage * 10 - 9
    let to = prevPage * 10

    choices[choices.length] = {
      name: `Prev page: ${prevPage} (${from} - ${to})`,
      value: 'prev',
      short: 'prev'
    }
  }

  // add a next page choice
  choices[choices.length] = {
    name: util.format('Next page: %s (%s - %s)',
      page + 1,
      ((page + 1) * 10) - 9,
      (page + 1) * 10
    ),
    value: 'next',
    short: 'previous'
  }

  // add search again choice
  choices[choices.length] = {
    name: 'Search Again',
    value: 'search',
    short: 'search'
  }

  // add a choice to exit
  choices[choices.length] = {
    name: 'Exit',
    value: 'exit', 
    short: 'exit'
  }

  // add a default separator to improve cyclical scrolling
  choices[choices.length] = new inquirer.Separator()

  log.debug('choices', choices)

  // format or "question" prompt 
  let question = {
    name: 'suggestions', 
    type: 'list', // shows a list and allows users to nav with up and down
                  // and select with enter/return
    choices: choices, 
    message: 'Please press "enter" to inspect a package' 
  }

  clearScreen()

  prompt(question, function (answers) {

    // display the package info

    log.debug('answers', answers)

    if ('string' === typeof answers.suggestions) {
      switch (answers.suggestions) {
        case 'next':    page+=1
                        clearScreen()
                        main(program.keywords)
                        break

        case 'prev':    page-=1
                        clearScreen()
                        main(program.keywords)
                        break

        case 'search':  searchPrompt()
                        break

        case 'exit':    clearScreen()
                        process.exit()
                        break

        default:        clearScreen()
                        listSuggestions()
                        break
      }
    } else {
      clearScreen()
      inspect(answers.suggestions)
    }
  })

  // run if defined
  next && next()

}

function prompt (question, callback) {

  inquirer.prompt([question], callback)
}

function searchPrompt () {
  let question = {
    name: 'search',
    message: 'search'
  }

  clearScreen()

  prompt(question, function (answers) {

    log.debug('answers.search', answers.search)

    let keywords = (answers.search) ? answers.search.split(' ') : program.keywords;

    main(keywords);
  })

}

function returnPrompt (done) {
  let question = {
    name: 'return',
    message: 'press "enter" to return'
  }

  prompt(question, function (answers) {

    log.debug('answers.return', answers.return)

    clearScreen()
    done && done()

  })
}


function continuePrompt (done) {
  let question = {
    name: 'continue',
    message: 'press "enter" to continue'
  }

  prompt(question, function (answers) {

    log.debug('answers.continue', answers.continue)

    done && done()

  })
}


function listHeaders () {
  // two spaces at beginning are intentional

  let header = util.format(' RATING%sNAME%sVERSION%sDESCRIPTION',
    ' '.repeat(7),
    ' '.repeat(20),
    ' '.repeat(9)
    )

  if (header.length > (process.stdout.columns - 3 ) ) {
    header = header.substring(0, process.stdout.columns - 2)
  }

  return header
}

function formatChoice (pkg) {

  log.debug('formatChoice', pkg)

  let displayRating = (Number(pkg.rating) < 10) 
    ? ' ' + pkg.rating.toFixed(1) 
    : pkg.rating.toFixed(1)

  let displayName = (pkg.name.length > 23)
      ? pkg.name.substr(0, 20) + '...'
      : pkg.name

  let suggestion_str = [
    displayRating,
    ' '.repeat('9'),
    displayName,
    ' '.repeat(24 - displayName.length),
    pkg.version,
    ' '.repeat(16 - String(pkg.version).length),
    pkg.description
  ].join('')

  if (suggestion_str.length > (process.stdout.columns - 2 ) ) {
    suggestion_str = suggestion_str.substr(0, process.stdout.columns - 3)
  }

  log.debug('suggestion_str', suggestion_str)

  return suggestion_str
}

function inspect (pkg) {

  console.log(`
  rating:           ${pkg.rating}
  name:             ${pkg.name}
  description:      ${pkg.description}
  author:           ${pkg.author}
  maintainers:      ${pkg.maintainers}
  version:          ${pkg.version}
  created:          ${moment(pkg.created).fromNow()}
  modified:         ${moment(pkg.modified).fromNow()}
  homepage:         ${pkg.homepage}
  repository:       ${pkg.repository}
  dependencies:     ${pkg.dependencies}
  devDependencies:  ${pkg.devDependencies}
  keywords:         ${pkg.keywords}
  
`)

  let choices = [
    {
      name: 'Return to Suggestions',
      value: 'return'
    },

    new inquirer.Separator(),
    
    // open readme in browser
    {
      name: 'View README.md',
      value: 'readme'
    },

    // open homepage in browser
    {
      name: 'Open homepage in browser',
      value: 'homepage'
    }
  ]

  if (pkg.repository) {
    choices[choices.length] = {
      name: 'Open repository in browser',
      value: 'repo'
    }
  }




  let question = {
    type: 'list',
    name: 'task',
    choices: choices,
    message: 'Press "enter" to select a task'
  }

  prompt(question, (answers) => {

    // log.debug('answers.task', answers.task)

    let task = answers.task

    switch (task) {
      case 'readme':    // console.log(pkg.readme)
                        // returnPrompt(() => inspect(pkg))

                        pagerReadme(pkg.readme, () => inspect(pkg))
                        break

      case 'return':    listSuggestions()
                        break

      case 'homepage':  open(pkg.homepage)
                        clearScreen()
                        inspect(pkg)
                        break

      case 'repo':      child_process.exec(`npm repo ${pkg.name}`, (err) => {
                          if (err) log.error('err', err)
                        })

                        clearScreen()
                        inspect(pkg)
                        break

      default:          clearScreen()
                        inspect(pkg)
    }
    
  })


  function pagerReadme (readme, done) {

    // an array of lines to output based upon screen size
    let outputLines = []
    let outputPages = []
  
    const ROWS = process.stdout.rows
    const COLUMNS = process.stdout.columns

    // each page will have ROWS - 1 row for prompt
    let rowsPerPage = ROWS - 1

    log.debug('ROWS', ROWS)
    log.debug('COLUMNS', COLUMNS)
    log.debug('rowsPerPage', rowsPerPage)

    // get each line    
    readme.split('\n').forEach(line => {

      if (line.length > COLUMNS) {
        outputLines.concat(
          line.match(
            new RegExp('.{1,' + COLUMNS + '}', 'g')
          )
        )
      } else {
        outputLines[outputLines.length] = line
      }

    })

    log.debug('outputLines', outputLines)

    let numPages = outputLines.length / rowsPerPage 
    
    log.debug('numPages', numPages)

    // fill outputPages array by joining appropriate lines
    for (let page = 0; page < numPages; page +=1 ) {

      let lineOffset = page * rowsPerPage;
      let lines = []

      // go through each line for each page
      for (let line = lineOffset; line < lineOffset + rowsPerPage && line < outputLines.length; line +=1) {

        // add each line to the array of lines of this page
        lines[lines.length] = outputLines[line]
        

      }

      log.debug('lines', lines)      

      outputPages[page] = lines.join('\n')
    }

    log.debug('outputPages', outputPages)

    let page = 0
    
    async.eachSeries(outputPages, (pageText, next) => {

      console.log(pageText)

      if (++page === outputPages.length) {
        returnPrompt(next)
      } else {
        continuePrompt(next)
      }

    }, (err) => {

      if (err) {
        log.error(err)
      } 

      done()
    })


    
    
  }




}
