// sfsemver.ts

import { readFileSync } from "node:fs";

const packageJson = JSON.parse(
    readFileSync(new URL("../../package.json", import.meta.url), "utf-8"),
);

const version: string = packageJson.version;

function generateRandomString(length: number): string {
    const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
    let result = "";

    for (let i = 0; i < length; i++) {
        const randomIndex = Math.floor(Math.random() * chars.length);
        result += chars[randomIndex];
    }

    return "sf-" + result;
}

function getQuarters() {
    let result = "";
    const date: Date = new Date();

    const month: number = date.getMonth() + 1;

    if (month >= 1 && month <= 3) {
        result = "Q1";
    } else if (month >= 4 && month <= 6) {
        result = "Q2";
    } else if (month >= 7 && month <= 9) {
        result = "Q3";
    } else {
        result = "Q4";
    }

    return result;
}

function getMonthName() {
    const date: Date = new Date();

    const month: number = date.getMonth() + 1;

    if (month === 1) return "Jan";
    else if (month === 2) return "Feb";
    else if (month === 3) return "Mar";
    else if (month === 4) return "Apr";
    else if (month === 5) return "May";
    else if (month === 6) return "Jun";
    else if (month === 7) return "Jul";
    else if (month === 8) return "Aug";
    else if (month === 9) return "Sep";
    else if (month === 10) return "Oct";
    else if (month === 11) return "Nov";
    else return "Dec";
}

function getYear(): number {
    return new Date().getFullYear();
}

function getMonthPeriod() {
    const date = new Date();
    const day = date.getDate();

    if (day <= 10) return "Early";
    if (day <= 20) return "Mid";
    return "Late";
}

const buildId: string = generateRandomString(4);
const quarter: string = getQuarters();
const monthPer: string = getMonthPeriod();
const year: number = getYear();
const month = getMonthName();

console.log(
    `sceneform Build ${version}+${buildId} ${quarter} ${year}, ${monthPer} ${month} ${year}`,
);

export function semver() {
    // version + buildId
    // ex: 1.0.0+9hmw8
    return `${version}+${buildId}`;
}

export function quaVer() {
    // quarter + year
    // ex: Q3 2026
    return `${quarter} ${year}`;
}

export function moVer() {
    // date pos on the month + month + year
    // ex: Mid Jul 2026
    return `${monthPer} ${month} ${year}`;
}

export function identifierFull() {
    return `sceneform Build ${version}+${buildId} ${quarter} ${year}, ${monthPer} ${month} ${year}`;
}
