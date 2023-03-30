# pg-native
A severely trimmed down version of brianc/node-pg-native to fit the needs of the pg-pool-minimal package.

### Usage

#### Creating A Client

```javascript
let connectionString = 'postgresql://user:password@127.0.0.1:5432/database';
let client = Client();

client.connect(connectionString, (err) => {
    if (err) throw err;
});
```

#### Queries

```javascript
await new Promise((resolve, reject) => {
    client.query(query, reject, resolve);
});
```

#### Prepared Queries

```javascript
await new Promise((resolve, reject) => {
    client.prepare(queryName, text, values.length, reject, () => {
        client.execute(queryName, values, reject, resolve);
    });
});
```

This is not intended to be used on its own, instead use the npm package pg-pool-minimal.

Checkout brianc/node-pg-native for the original version with extensive documentation.

#### Future Plans

Transforming the client into a typescript class to further reduce the range of possible bugs by introducing typesafety. 
