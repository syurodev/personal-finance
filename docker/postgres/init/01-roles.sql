-- Chạy một lần khi volume trống, với quyền superuser.
CREATE ROLE pf_owner LOGIN PASSWORD 'pf_owner';
CREATE ROLE pf_app LOGIN PASSWORD 'pf_app';

CREATE DATABASE personal_finance OWNER pf_owner;
CREATE DATABASE personal_finance_test OWNER pf_owner;
