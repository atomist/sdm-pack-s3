import * as assert from "power-assert";
import { filterKeys } from "../lib/deleteS3";

describe("filterKeys", () => {

    it("should filter out all objects", () => {
        const k = ["Rage", "Against", "the", "Machine", "RageAgainstTheMachine/01-Bombtrack.mp3"];
        const o = [
            { Key: "Rage" },
            { Key: "Machine" },
            { Key: "RageAgainstTheMachine/01-Bombtrack.mp3" },
        ];
        const r = filterKeys(k, o);
        assert.deepStrictEqual(r, []);
    });

    it("should filter out objects without keys", () => {
        const k = ["Rage", "Against", "the", "Machine", "RageAgainstTheMachine/01-Bombtrack.mp3"];
        const o = [
            { Size: 1993 },
            { ETag: "Rage" },
            {
                Owner: {
                    DisplayName: "Against",
                    ID: "TheMachine",
                },
            },
        ];
        const r = filterKeys(k, o);
        assert.deepStrictEqual(r, []);
    });

    it("should filter objects that do not match keys", () => {
        const k = ["Rage", "Against", "the", "Machine", "RageAgainstTheMachine/02-KillingInTheName.mp3"];
        const o = [
            { Key: "Rage" },
            { Key: "Machine" },
            { Key: "RageAgainstTheMachine/01-Bombtrack.mp3" },
            { Key: "RageAgainstTheMachine/02-KillingInTheName.mp3" },
            { Key: "RageAgainstTheMachine/03-TakeThePowerBack.mp3" },
        ];
        const r = filterKeys(k, o);
        const e = [
            { Key: "RageAgainstTheMachine/01-Bombtrack.mp3" },
            { Key: "RageAgainstTheMachine/03-TakeThePowerBack.mp3" },
        ];
        assert.deepStrictEqual(r, e);
    });

    it("should only filter objects on keys", () => {
        const k = ["Rage", "Against", "the", "Machine", "RageAgainstTheMachine/02-KillingInTheName.mp3"];
        const o = [
            { ETag: "Rage", Key: "AgainstThe" },
            { Key: "The", StorageClass: "Machine" },
            { Key: "RageAgainstTheMachine/01-Bombtrack.mp3" },
            { Key: "RageAgainstTheMachine/02-KillingInTheName.mp3" },
            { Key: "RageAgainstTheMachine/03-TakeThePowerBack.mp3" },
        ];
        const r = filterKeys(k, o);
        const e = [
            { Key: "AgainstThe" },
            { Key: "The" },
            { Key: "RageAgainstTheMachine/01-Bombtrack.mp3" },
            { Key: "RageAgainstTheMachine/03-TakeThePowerBack.mp3" },
        ];
        assert.deepStrictEqual(r, e);
    });

});
