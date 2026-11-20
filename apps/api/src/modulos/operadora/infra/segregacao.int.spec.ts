// M56 regra 8 (ficha, seção 8; cap-07 §7.4 e cap-08 §8.13) na cópia, numa transação SEMPRE desfeita: o beneficiário
// que também é paciente do hospital tem os dois cadastros separados. A ligação é só o ID do cadastro do paciente em
// SGH_OPE_BENEFICIARIO (sem FK): a inclusão só confere a existência pela chave (contagem), não lê nem grava nada do
// paciente; a transação não escreve em tabela do outro sistema; a ficha do beneficiário não traz dado clínico (só os
// campos cadastrais da operadora e o número do cadastro); o ID inexistente é recusado. O ID do paciente de amostra é
// lido da cópia pelo repositório do atendimento externo (só o ID, nunca nome ou documento) e nunca impresso.
import { atendimentoExternoDeAmostra, escritasDaTransacao, type NucleoLegado } from '@sgh/legado';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  COD,
  codigoDe,
  criarNucleo,
  montarCarteira,
  PODE,
  servicoNaTransacao,
  sessao,
} from './copia.spec-util.js';

let nucleo: NucleoLegado;
beforeAll(async () => {
  if (!PODE) return;
  nucleo = criarNucleo();
  await nucleo.verificarSchema(COD);
});
afterAll(async () => {
  if (PODE) await nucleo.encerrar();
});

/** Campos que a ficha do beneficiário pode ter (cadastro da operadora); nenhum clínico. */
const CAMPOS_DA_FICHA = [
  'carteirinha',
  'carteirinhas',
  'cns',
  'contrato',
  'contratoNumero',
  'cpf',
  'dependentes',
  'exclusao',
  'id',
  'inclusao',
  'motivoBaixa',
  'nascimento',
  'nome',
  'nomeMae',
  'nomeSocial',
  'operadora',
  'pacienteHospital',
  'produtoNome',
  'registroAnsOperadora',
  'sexo',
  'situacao',
  'titular',
  'versao',
  'via',
  'vinculo',
  'alteradoEm',
].sort();

describe.skipIf(!PODE)('regra 8: beneficiário que é paciente, cadastros separados (na cópia)', () => {
  it('só o ID do paciente na operadora; nada lido nem gravado do cadastro do paciente; ID inexistente recusado', async () => {
    const r = await nucleo.desfazendoNaCopia(
      { rede: nucleo.rede, hospital: COD, traceId: 'int-m56-segrega' },
      async (e) => {
        const amostra = await atendimentoExternoDeAmostra(e);
        if (!amostra) throw new Error('Nenhum atendimento externo na cópia.');
        const paciente = amostra.paciente;
        const { servico } = servicoNaTransacao(e);
        const s = sessao(nucleo.rede);
        const k = await montarCarteira(servico, s, {
          registro: '990581',
          base: '99059',
          pacienteHospital: paciente,
        });
        const ficha = await servico.ficha(s, k.titular.id);
        const linha = await servicoNaTransacao(e).porta.beneficiario(
          { rede: nucleo.rede, hospital: COD },
          k.titular.id,
        );
        const inexistente = await codigoDe(
          servico.gravarBeneficiario(s, k.titular.id, {
            contrato: k.contrato,
            titular: null,
            vinculo: 1,
            nome: ficha.nome,
            nomeSocial: null,
            cpf: ficha.cpf,
            nascimento: ficha.nascimento,
            sexo: ficha.sexo,
            cns: null,
            nomeMae: ficha.nomeMae,
            inclusao: ficha.inclusao,
            pacienteHospital: 2_000_000_000,
            versao: ficha.versao,
          }),
        );
        const tabelas = (await escritasDaTransacao(e)).filter(
          (w) => w.insercoes + w.alteracoes + w.exclusoes > 0,
        );
        return {
          mesmoId: linha?.pacienteHospital === paciente && ficha.pacienteHospital === paciente,
          campos: Object.keys(ficha).sort(),
          inexistente,
          tabelas: tabelas.map((w) => w.tabela),
        };
      },
    );
    expect(r.mesmoId).toBe(true);
    expect(r.campos).toEqual(CAMPOS_DA_FICHA);
    expect(r.inexistente).toBe('paciente-inexistente');
    expect(r.tabelas.includes('RICADPAC')).toBe(false);
    expect(r.tabelas.every((t) => t.startsWith('SGH_') || t.startsWith('RDB$'))).toBe(true);
    console.log(
      `[int-m56.2] ${COD}: regra 8 conferida; tabelas escritas: ${r.tabelas.length} (só SGH_), desfeito`,
    );
  });
});
