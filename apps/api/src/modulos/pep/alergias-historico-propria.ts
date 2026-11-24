// Histórico e manifestações da alergia do paciente sobre o banco PRÓPRIO do cliente (03-PEP L100). Leitura só:
// a gravação do evento e das manifestações é feita por pep.registrarAlergia e pep.inativarAlergia
// (documentos-propria-operacoes.ts), na mesma transação da alergia. Tabelas: alergia_paciente, alergia_paciente_evento,
// alergia_paciente_manifestacao, manifestacao_alergica, profissional, pessoa_fisica e estabelecimento.
// O paciente é do cliente inteiro: a alergia de qualquer estabelecimento do cliente tem o histórico lido; as datas saem
// no fuso do estabelecimento da sessão. Nada é apagado nem escondido: a alergia retirada mostra o histórico inteiro.
import { linhaDoTempoDaAlergia, type PassoDoHistoricoAlergia } from '@sgh/dominio-pep';
import { ErroOperacao } from '@sgh/nucleo';
import type { ContextoAlergias } from './alergias-propria.js';
import { dataHora, fusoValido, type NucleoLeituraPep } from './registro-porta-propria.js';

export interface ManifestacaoLida {
  readonly id: number;
  readonly codigo: string;
  readonly nome: string;
}

export interface HistoricoAlergiaLido {
  readonly alergia: number;
  readonly manifestacoes: ManifestacaoLida[];
  readonly passos: PassoDoHistoricoAlergia[];
}

const num = (v: unknown): number => Number(v);
const textoOuNull = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const t = String(v).trim();
  return t === '' ? null : t;
};

/** O histórico da alergia do paciente (linha do tempo, da mais antiga) e as manifestações dela. 404 se não é dele. */
export function historicoDaAlergia(
  nucleo: NucleoLeituraPep,
  cliente: string,
  c: ContextoAlergias,
  paciente: number,
  alergia: number,
): Promise<HistoricoAlergiaLido> {
  return nucleo.lerSomente(
    { cliente: c.cliente || cliente, correlacao: 'pep.alergias.historico' },
    async (l) => {
      const e = await l.uma<{ fuso_horario: unknown }>(
        'SELECT fuso_horario FROM estabelecimento WHERE codigo = ? AND excluido_em IS NULL',
        [c.hospital],
      );
      if (!e)
        throw new ErroOperacao(
          404,
          'estabelecimento-inexistente',
          'Estabelecimento não encontrado',
          'O estabelecimento da sessão não existe neste cliente.',
        );
      const fuso = fusoValido(e.fuso_horario);
      const a = await l.uma(
        'SELECT id FROM alergia_paciente WHERE id = ? AND paciente_id = ? AND excluido_em IS NULL',
        [alergia, paciente],
      );
      if (!a)
        throw new ErroOperacao(
          404,
          'registro-inexistente',
          'Alergia não encontrada',
          'A alergia não é deste paciente.',
        );
      const eventos = await l.consultar(
        `SELECT ev.id, ev.evento, ev.ocorrido_em, ev.motivo, COALESCE(p.nome_exibicao, pf.nome) AS profissional
           FROM alergia_paciente_evento ev
           LEFT JOIN profissional p ON p.id = ev.profissional_id
           LEFT JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
          WHERE ev.alergia_paciente_id = ?
          ORDER BY ev.ocorrido_em, ev.id`,
        [alergia],
      );
      const manifs = await l.consultar(
        `SELECT ma.id, ma.codigo, ma.descricao
           FROM alergia_paciente_manifestacao m
           JOIN manifestacao_alergica ma ON ma.id = m.manifestacao_alergica_id
          WHERE m.alergia_paciente_id = ? AND m.excluido_em IS NULL
          ORDER BY ma.descricao, ma.id`,
        [alergia],
      );
      return {
        alergia,
        manifestacoes: manifs.map((x) => ({
          id: num(x['id']),
          codigo: String(x['codigo']),
          nome: String(x['descricao']),
        })),
        passos: linhaDoTempoDaAlergia(
          eventos.map((x) => ({
            id: num(x['id']),
            evento: String(x['evento']),
            ocorridoEm: dataHora(x['ocorrido_em'], fuso),
            profissional: textoOuNull(x['profissional']),
            motivo: textoOuNull(x['motivo']),
          })),
        ),
      };
    },
  );
}

/** O catálogo de manifestações ativas, por nome (para a escolha na tela de alergias). */
export function catalogoManifestacoes(
  nucleo: NucleoLeituraPep,
  cliente: string,
  c: ContextoAlergias,
): Promise<ManifestacaoLida[]> {
  return nucleo.lerSomente(
    { cliente: c.cliente || cliente, correlacao: 'pep.alergias.manifestacoes' },
    async (l) => {
      const linhas = await l.consultar(
        'SELECT id, codigo, descricao FROM manifestacao_alergica WHERE ativo = TRUE ORDER BY descricao, id',
        [],
      );
      return linhas.map((x) => ({
        id: num(x['id']),
        codigo: String(x['codigo']),
        nome: String(x['descricao']),
      }));
    },
  );
}
