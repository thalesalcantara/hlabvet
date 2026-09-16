-- MIGRAÇÃO 0009 DESATIVADA COM SEGURANÇA.
-- A versão antiga alterava a tabela central users e não deve mais ser utilizada.
-- O login do entregador agora é criado de forma separada pela migration 0010.
PRAGMA foreign_keys = ON;
