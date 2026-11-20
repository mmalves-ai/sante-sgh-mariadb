// EFD-REINF da competência (M32; ficha, regra 18): as retenções dos títulos a pagar da competência viram o arquivo da
// série R-2000 (R-2010, INSS dos serviços tomados) ou R-4000 (R-4020, IR e CSRF de pessoa jurídica), GERADO E NÃO
// ENVIADO até a DP-38. O arquivo vai ao armazém com a impressão digital (SHA-256) e o registro guarda a contagem e o
// valor total; nada sai para a Receita (esta rotina não tem como enviar: não há cliente de rede aqui).
import { createHash } from 'node:crypto';
import { gerarReinf, type RetencaoServico } from '@sgh/dominio-financeiro';

export interface FonteReinf {
  retencoes(hospital: string, ano: number, mes: number): Promise<readonly RetencaoServico[]>;
  cnpjContribuinte(hospital: string): Promise<string>;
  guardar(hospital: string, nome: string, conteudo: string): Promise<string | null>;
  registrar(
    hospital: string,
    d: {
      tipo: 'reinf-r2000' | 'reinf-r4000';
      periodo: string;
      leiaute: string;
      registros: number;
      valorTotal: number;
      hashArquivo: string;
      chaveObjeto: string | null;
    },
  ): Promise<{ id: number }>;
}

export interface ResultadoReinf {
  readonly id: number;
  readonly registros: number;
  readonly valorTotal: number;
  readonly hash: string;
  readonly situacao: 'gerado-nao-enviado';
}

export async function gerarReinfDaCompetencia(
  fonte: FonteReinf,
  hospital: string,
  periodo: string,
  serie: 'R-2000' | 'R-4000',
): Promise<ResultadoReinf> {
  const m = /^(\d{4})-(\d{2})$/.exec(periodo);
  if (!m) throw new Error('Competência inválida (use AAAA-MM).');
  const [ano, mes] = [Number(m[1]), Number(m[2])];
  const arquivo = gerarReinf(
    serie,
    periodo,
    await fonte.cnpjContribuinte(hospital),
    await fonte.retencoes(hospital, ano, mes),
  );
  const hash = createHash('sha256').update(arquivo.conteudo, 'utf8').digest('hex');
  const tipo = serie === 'R-2000' ? 'reinf-r2000' : 'reinf-r4000';
  const chave = await fonte.guardar(hospital, `${tipo}-${periodo}.xml`, arquivo.conteudo);
  const r = await fonte.registrar(hospital, {
    tipo,
    periodo,
    leiaute: `EFD-REINF ${serie}`,
    registros: arquivo.registros,
    valorTotal: arquivo.valorTotal,
    hashArquivo: hash,
    chaveObjeto: chave,
  });
  return {
    id: r.id,
    registros: arquivo.registros,
    valorTotal: arquivo.valorTotal,
    hash,
    situacao: arquivo.situacao,
  };
}
