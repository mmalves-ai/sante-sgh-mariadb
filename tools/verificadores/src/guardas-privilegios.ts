// pnpm guardas:legado -- --privilegios [--hospital=pc] [--estrito]
// M59-F1 (ficha do M59, regra 4: "relatório de RDB$USER_PRIVILEGES comparado com a matriz de módulos (pnpm
// guardas:legado estendido, Desvio)"): lê da cópia, em transação de leitura, os privilégios dos titulares SGH_ e os
// compara com o plano versionado por módulo. Excesso (privilégio do banco fora do plano, inclusive privilégio direto
// numa conta por módulo) é Desvio e deixa o portão vermelho; a falta só é vermelha com --estrito (antes de a TI
// aplicar o passo 0001, a falta é o plano inteiro e é esperada). Sem cópia configurada: só confere que o plano existe.
import { resolve } from 'node:path';
import { alcanceVersionado, lerConfiguracaoNucleo, lerPrivilegiosReais, NucleoLegado } from '@sgh/legado';
import { criarDriverNativo } from '@sgh/legado/nativo';
import { montarDesvios } from '@sgh/dominio-acesso';
import { lerArgumentos } from './argumentos.ts';
import { codigosDaCopia } from './permissoes-copia.ts';

export async function principalPrivilegios(argv: readonly string[]): Promise<number> {
  const raiz = resolve(import.meta.dirname, '../../..');
  const { opcoes, bandeiras } = lerArgumentos(argv);
  const h = opcoes['hospital'] ?? 'pc';
  const alcance = alcanceVersionado(h);
  if (!alcance) {
    console.error(
      `[guardas:legado --privilegios] sem plano versionado para "${h}" (pnpm privilegios:gerar).`,
    );
    return 1;
  }
  const copia = codigosDaCopia();
  if (!copia || !copia.codigos.includes(h)) {
    console.log(
      `[guardas:legado --privilegios] ${h}: plano ${alcance.versao} (${alcance.alcances.length} módulo(s)); ` +
        'sem cópia configurada, comparação com o banco não feita → verde',
    );
    return 0;
  }
  const nucleo = new NucleoLegado({
    env: copia.env,
    driver: criarDriverNativo({ biblioteca: lerConfiguracaoNucleo(copia.env).bibliotecaCliente }),
    pastaHomologada: resolve(raiz, 'tools/schema-check/homologado'),
    aviso: () => undefined,
  });
  try {
    const reais = await nucleo.lerSomente(
      { rede: nucleo.rede, hospital: h, traceId: 'guardas-privilegios' },
      (l) => lerPrivilegiosReais(l, { prefixo: 'SGH_' }),
    );
    const d = montarDesvios({
      hospital: h,
      em: new Date().toISOString(),
      alcances: alcance.alcances,
      reais,
      contasConfiguradas: new Set(),
    });
    for (const x of d.excesso.slice(0, 40))
      console.error(
        `[guardas:legado --privilegios] Desvio: ${x.titular} tem ${x.acao} em ${x.objeto} fora do plano`,
      );
    const vermelho = d.excessoTotal > 0 || (bandeiras.has('estrito') && d.faltaTotal > 0);
    console.log(
      `[guardas:legado --privilegios] ${h}: plano ${d.versaoPlano} (${d.modulos.length} módulo(s)), ` +
        `${d.planoAplicado ? 'aplicado' : 'ainda não aplicado'}; iguais ${d.iguais}, excesso ${d.excessoTotal}, ` +
        `falta ${d.faltaTotal} → ${vermelho ? 'VERMELHO' : 'verde'}`,
    );
    return vermelho ? 1 : 0;
  } finally {
    await nucleo.encerrar();
  }
}
