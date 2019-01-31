# Dashboard Proxy

This project aims to integrate Azure Active Directory and [Kubernetes RBAC](https://kubernetes.io/docs/admin/authorization/rbac/).

## Build

TODO

## Deploy

You can use provided helm to deploy the Dashboard AD proxy.

Make a copy of the ./charts/dashboard-proxy/example_values and fill in the values for your environment.

```bash
helm upgrade dashboard-proxy --install ./charts/dashboard-proxy/ \
 -f ./charts/dashboard-proxy/values.yaml --namespace=$namespace --tiller-namespace=$namespace
```