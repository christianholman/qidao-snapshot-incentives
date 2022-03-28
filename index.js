const fs = require("fs");
const path = require("path");
const fetch = require("isomorphic-fetch");
const { BLOCK_TIMES_MS, VAULTS } = require("./constants");
const { BigNumber, ethers } = require("ethers");
const { parseUnits } = require("ethers/lib/utils");

const CHAIN_THRESHOLD_BP = 850;

Object.filter = (obj, predicate) =>
  Object.keys(obj)
    .filter((key) => predicate(obj[key]))
    .reduce((res, key) => ((res[key] = obj[key]), res), {});

const buildMap = (keys, values) => {
  const map = new Map();
  for (let i = 0; i < keys.length; i++) {
    map.set(keys[i], values[i]);
  }
  return map;
};

const QI_PER_POLYGON_BLOCK = BigNumber.from("65000000000000000");

async function main() {
  const args = process.argv.slice(2);
  if (args.length > 0) {
    const res = await fetch("https://hub.snapshot.org/graphql", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        query: `{
            proposal(id: "${args[0]}") {
                choices
                scores
            }
        }`,
      }),
    });
    const {
      data: {
        proposal: { choices, scores },
      },
    } = await res.json();

    const choiceScoreMap = buildMap(choices, scores);

    const scoreSum = parseUnits(
      scores.reduce((prev, curr) => (prev += curr), 0).toString()
    );

    let includedChainIds = [];
    let chainIdScoreSumMap = new Map();

    for (chainId of [
      ...new Set(
        choices.map((choice) =>
          VAULTS[choice] ? VAULTS[choice].chainId : console.log(choice)
        )
      ),
    ]) {
      const chainIdVaults = Object.filter(
        VAULTS,
        (choice) => choice.chainId == chainId
      );

      let chainIdSum = 0;
      for (let i = 0; i < Object.keys(chainIdVaults).length; i++) {
        const vault = Object.keys(chainIdVaults)[i];
        chainIdSum += choiceScoreMap.get(vault);
      }

      let chainIdScoreSum = parseUnits(chainIdSum.toString());
      chainIdScoreSumMap.set(chainId, chainIdScoreSum);

      if (
        parseFloat(chainIdScoreSum.toString()) /
          parseFloat(scoreSum.toString()) >
        CHAIN_THRESHOLD_BP / 10000
      ) {
        includedChainIds.push(chainId);
      }
    }

    let includedChoices = [];
    for (let i = 0; i < choices.length; i++) {
      const choice = choices[i];
      const score = scores[i];
      if (includedChainIds.includes(VAULTS[choice].chainId)) {
        includedChoices.push({
          name: choice,
          score: score,
        });
      }
    }

    let includedChoicesScoreSum = includedChoices.reduce(
      (prev, curr) => (prev += curr.score),
      0
    );

    let borrowIncentives = [];

    for (let i = 0; i < includedChoices.length; i++) {
      const choice = includedChoices[i];
      const { name, score } = choice;
      const meta = VAULTS[name];
      if (score > 0) {
        const reward = QI_PER_POLYGON_BLOCK.mul(BLOCK_TIMES_MS[137])
          .div(BigNumber.from(BLOCK_TIMES_MS[meta.chainId]))
          .mul(parseUnits(score.toString()))
          .div(parseUnits(includedChoicesScoreSum.toString()));

        const minCdr = meta.minCdr / 100 + 0.25;
        const maxCdr = meta.minCdr / 100 + 2.7;

        borrowIncentives.push({
          name,
          vaultAddress: meta.address,
          minCdr,
          maxCdr,
          rewardPerBlock: reward.toString(),
          collateralDecimals: meta.collateralDecimals,
          startBlock: 18840162,
          endBlock: 99999999,
          chainId: meta.chainId.toString(),
        });
      }
    }

    let values = {};
    [...new Set(borrowIncentives.map((b) => b.chainId))].forEach(
      (chainId) =>
        (values[chainId] = borrowIncentives.filter(
          (incentive) => incentive.chainId == chainId
        ))
    );
    const fileName = path.join(__dirname, `/results/${args[0]}.json`);
    const output = JSON.stringify({
      details: {
        proposal: args[0],
      },
      ...values,
    });
    fs.writeFileSync(fileName, output);
  } else {
    console.log("Usage: node index.js <ProposalId>");
  }
}

main();
