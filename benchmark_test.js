const { promisify } = require('util');
const fs = require('fs');
const convert = require('heic-convert');
const { performance } = require('perf_hooks');
const { fork } = require('child_process');

/**
 * This file contains several functions you can run to get a sense of how heic-convert
 * is going to perform under different scenarios:
 *    1 - On the main Thread spawning parallel Promises.
 *    2 - On the main Thread sequentially spawning promises.
 *    3 - Processing 1 image with a child_process.
 *    4 - Sequentially process images on a single child_process.
 *    5 - Process images in parallel, spawning as many child_processes as images.
 *    The test_results folder must be manually emptied before running each benchmark
 */

async function oneTestPromises () {
  const start = process.hrtime();
  const inputBuffer = await promisify(fs.readFile)('./test_image.heic');
  const promises = [];
  for (i = 0; i < 100; i++) {
    const index = i;
    const promise = new Promise(async (resolve, reject) => {
      try {
        const outputBuffer = await convert({
          buffer: inputBuffer, // the HEIC file buffer
          format: 'JPEG',      // output format
          quality: 1           // the jpeg compression quality, between 0 and 1
        });
        await promisify(fs.writeFile)(`./test_results/result-${index}.jpg`, outputBuffer);
        resolve();
      } catch(e) {
        console.log(e);
        reject();
      }
    });

    promises.push(promise);
  }
  await Promise.all(promises);
  const end = process.hrtime(start);
  console.log(`Took: ${end[0]}s, ${end[1] / 1000000}ms`);
}

async function twoTestSequential () {
  const start = process.hrtime();
  const inputBuffer = await promisify(fs.readFile)('./test_image.heic');
  for (i = 0; i < 100; i++) {
    const outputBuffer = await convert({
      buffer: inputBuffer, // the HEIC file buffer
      format: 'JPEG',      // output format
      quality: 1           // the jpeg compression quality, between 0 and 1
    });
    await promisify(fs.writeFile)(`./test_results/result-${i}.jpg`, outputBuffer);
  }
  const end = process.hrtime(start);
  console.log(`Took: ${end[0]}s, ${end[1] / 1000000}ms`);
}

async function threeTestSingleWorker () {
    const start = process.hrtime();
    const worker = fork(`${__dirname}/worker.js`);
    worker.send({ inputPath: './test_image.heic', outputPath: './test_results/C001.jpg'})

    const success = await new Promise((resolve, reject) => {
        worker.once('message', (message) => resolve(message));
    });

    const end = process.hrtime(start);
    console.log(`${success} Took: ${end[0]}s, ${end[1] / 1000000}ms`);
}

async function fourTestSequentialWithWorker () {
    const start = process.hrtime();
    const worker = fork(`${__dirname}/worker.js`);

    for (i = 0; i < 100; i++) {
        try {
            await new Promise((resolve, reject) => {
                const errorHandler = (error) => {
                    console.log(error);
                    reject(error);
                };
                worker.send({ inputPath: './test_image.heic', outputPath: `./test_results/result-${i}.jpg`})
                worker.once('message', (message) => {
                    worker.removeListener('error', errorHandler);
                    resolve(message);
                });
                worker.once('error', errorHandler);
            });
        } catch(e) {
            console.log(e);
        }
    }
    worker.send({ exit: true });
    const end = process.hrtime(start);
    console.log(`Took: ${end[0]}s, ${end[1] / 1000000}ms`);
}

async function fiveTestPromisesSpawningWorkers () {
    const start = process.hrtime();
    const inputBuffer = await promisify(fs.readFile)('./test_image.heic');
    const promises = [];
    for (i = 0; i < 100; i++) {
        const promise = new Promise((resolve, reject) => {
            const worker = fork(`${__dirname}/worker.js`);
            worker.send({ inputPath: './test_image.heic', outputPath: `./test_results/result-${i}.jpg`})
            worker.once('message', (message) => {
                // In the future we might want to process more than one file per worker
                // so intead of making the worker exit after processing a message,
                // we send a explicit call from the parent.
                worker.send({ exit: true });
                resolve(message);
            });
            worker.once('error', (error) => {
              console.log(error);
              reject(error);
            });
        });
        promises.push(promise);
    }
    await Promise.all(promises);
    const end = process.hrtime(start);
    console.log(`Took: ${end[0]}s, ${end[1] / 1000000}ms`);
}

function benchmark() {
    const benchmark = process.argv.slice(2)[0];
    const benchmarks = {
        '1': oneTestPromises,
        '2': twoTestSequential,
        '3': threeTestSingleWorker,
        '4': fourTestSequentialWithWorker,
        '5': fiveTestPromisesSpawningWorkers
    }
    if (Object.keys(benchmarks).includes(benchmark)) {
        benchmarks[benchmark]();
    } else {
        console.log(`usage:
            node benchmark_test.js <number (1 to 5)>
        `);
    }
}

benchmark();
