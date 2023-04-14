# pg-native

A severely trimmed down version of brianc/node-pg-native to fit the needs of the pg-pool-minimal package.

This is not intended to be used on its own, it was originally used in the package pg-pool-minimal but since v1.2.0 the pool directly used the libpq connection.

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

Checkout brianc/node-pg-native for the original version with extensive documentation.
