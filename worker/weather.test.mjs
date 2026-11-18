import test from 'node:test';
import assert from 'node:assert/strict';
import { pointsFromNwsPeriods, pointsFromOpenMeteo } from './weather.js';

test('open-meteo hours become fahrenheit points on the requested day', () => {
  const points = pointsFromOpenMeteo({
    utc_offset_seconds: -25200,
    hourly: {
      time: ['2026-11-23T09:00', '2026-11-23T10:00'],
      temperature_2m: [41.2, 43],
      wind_speed_10m: [4, 6],
      precipitation_probability: [30, 10],
    },
  });
  assert.equal(points.length, 2);
  assert.equal(points[0].tempF, 41.2);
  assert.equal(points[0].precipProb, 30);
  assert.equal(points[0].timeIso, '2026-11-23T16:00:00.000Z');
});

test('nws periods keep the requested local date and read rain chance', () => {
  const points = pointsFromNwsPeriods(
    [
      {
        startTime: '2026-11-22T23:00:00-07:00',
        temperature: 30,
        temperatureUnit: 'F',
        windSpeed: '5 mph',
        probabilityOfPrecipitation: { value: 0 },
      },
      {
        startTime: '2026-11-23T09:00:00-07:00',
        temperature: 40,
        temperatureUnit: 'F',
        windSpeed: '10 to 15 mph',
        probabilityOfPrecipitation: { value: 34 },
      },
    ],
    '2026-11-23',
  );
  assert.equal(points.length, 1);
  assert.equal(points[0].tempF, 40);
  assert.equal(points[0].windMph, 10);
  assert.equal(points[0].precipProb, 34);
  assert.equal(points[0].timeIso, '2026-11-23T16:00:00.000Z');
});
