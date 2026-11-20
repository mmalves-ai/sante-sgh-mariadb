// Regras puras de estoque, almoxarifado e compras (M28). As regras moram em `@sgh/contratos/regras-suprimentos` (o
// adaptador do legado confere antes de gravar e só depende de contratos: fronteira Nx, D-REGRAS-28); este pacote as
// publica para a API e a tela e guarda os testes de unidade e a cobertura delas.
export * from '@sgh/contratos/regras-suprimentos';
