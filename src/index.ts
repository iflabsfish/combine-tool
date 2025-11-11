import { CreateTransactionRequest, NativeAssetId, RpcHttpClient, Transaction } from "@ironfish/sdk";
import * as fs from "fs/promises";

const rpcUrl = process.env.RPC_URL;
const output = process.env.OUTPUT;
const account = process.env.ACCOUNT;
const batchSize = parseInt(process.env.BATCH_SIZE || '1');

if (!rpcUrl) {
    console.error('Specify `RPC_URL` environment variable pointing to Http RPC endpoint of IronFish node');
    process.exit(1);
}

if (!output) {
    console.error('Specify `OUTPUT` environment variable with path to CSV file where results should be written');
    process.exit(2);
}

if (!account) {
    console.error('Specify `ACCOUNT` environment variable with account name');
    process.exit(3);
}

if (!batchSize) {
    console.error('Specify `BATCH_SIZE` environment variable with batch size');
    process.exit(4);
}

async function main(rpcUrl: string, output: string, account: string, batchSize: number) {
    const provider = new RpcHttpClient(`http://${rpcUrl}`);

    const file = await fs.open(output, 'w');
    file.appendFile(
        `Date,TxHash,NumOfNotes\n`,
    );

    const response = await provider.wallet.getAccountPublicKey({ account });
    const to = response.content.publicKey;

    let processedNotes = 0;
    while (processedNotes < batchSize) {
        const getNotesResponse = await provider.wallet.getNotes({
            account, pageSize: 3000, filter: {
                assetId: NativeAssetId,
                spent: false
            }
        });
        let totalAmount = 0n;
        let notesToUse = [];
        for (const note of getNotesResponse.content.notes) {
            processedNotes += 1;
            if (!note.index) {
                continue;
            }
            // skip note with amount > 50IRON
            if (BigInt(note.value) > 5_000_000_000n) {
                continue;
            }
            notesToUse.push(note);
            totalAmount += BigInt(note.value);
            if (processedNotes % 300 === 0) {
                console.log(`Creating transaction for account ${account} with ${notesToUse.length} notes`);
                const params: CreateTransactionRequest = {
                    account,
                    outputs: [
                        {
                            publicAddress: to,
                            amount: totalAmount.toString(),
                            assetId: NativeAssetId,
                            memo: 'Combine notes',
                        }
                    ],
                    fee: "5",
                    expirationDelta: 30,
                    notes: notesToUse.map((note) => note.noteHash),
                };
                const createTransactionResponse = await provider.wallet.createTransaction(params);
                const response = await provider.wallet.postTransaction({ transaction: createTransactionResponse.content.transaction, account });
                const bytes = Buffer.from(response.content.transaction, 'hex');
                const transaction = new Transaction(bytes);
                const hash = transaction.hash().toString('hex');
                await file.appendFile(
                    `${Date.now()},${hash},${notesToUse.length}\n`,
                );
                notesToUse = [];
                totalAmount = 0n;
            }
        }
        console.log(`Processed ${processedNotes} notes`);
    }

    await file.close();

    console.log('Finsihed successfully');

    process.exit(0);
}

main(rpcUrl, output, account, batchSize);