// O estabelecimento do endereço do portal sem código (/resultados, /medico/cadastro).
// No banco, é o primeiro estabelecimento ativo do cliente. Na fonte sintética (memória, sem banco), a lista do banco
// vem vazia e o portal ficava sem estabelecimento: a tela postava em /api/portal//paciente e recebia 404. Na memória,
// vale então o primeiro código configurado em ESTABELECIMENTOS (o mesmo critério do portal do paciente); a vigia
// continua só nos estabelecimentos do banco.

const CODIGO = /^[a-z0-9]{1,10}$/;

export function estabelecimentoPadraoDoPortal(
  ativos: readonly string[],
  memoria: boolean,
  env: Readonly<Record<string, string | undefined>>,
): string | null {
  const doBanco = ativos.find((c) => CODIGO.test(c));
  if (doBanco !== undefined) return doBanco;
  if (!memoria) return null;
  const configurado = (env['ESTABELECIMENTOS'] ?? '')
    .split(',')
    .map((x) => x.trim())
    .find((c) => CODIGO.test(c));
  return configurado ?? null;
}
