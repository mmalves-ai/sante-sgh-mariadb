// Prova de que os triggers do legado disparam na cópia (M01, ficha seção 10). Só roda contra o container
// de cópia do projeto, em AMBIENTE=dev, com host em loopback: recusa sante-firebird e qualquer outro.
// Só insere depois de conferir que a cópia está neutralizada. Um paciente SINTÉTICO é inserido em RICADPAC
// numa transação desfeita por ROLLBACK (GEN_IDRICADPAC e GEN_ID_HTPACIENTE avançam 1 por execução;
// TBGERSEQ volta). Saída só com marcadores, contagens e avanço de generator.
import { resolve } from 'node:path';
import {
  type DestinoAprovado,
  FUNCOES_EXTERNAS,
  ambienteEfetivo,
  caminhoArquivoAmbiente,
  chamarFuncaoExterna,
  conferirPublicacao,
  lerCodigos,
  lerEstadoNeutralizacao,
  listarContainers,
  provarTriggers,
  validarPedidoCopia,
} from '@sgh/legado';
import { beforeAll, describe, expect, it } from 'vitest';

const raiz = resolve(import.meta.dirname, '../../../..');
const { env } = ambienteEfetivo(caminhoArquivoAmbiente(process.env, raiz));
const codigos = lerCodigos(env);

describe('prova dos triggers: pré-condições', () => {
  it('há estabelecimento configurado e o ambiente é dev', () => {
    expect(env['AMBIENTE']?.trim() || 'dev').toBe('dev');
    expect(codigos.length).toBeGreaterThan(0);
  });

  it.skipIf(codigos.length === 0)('recusa sante-firebird e host fora do loopback antes de conectar', () => {
    const cod = codigos[0] as string;
    const chave = `FB_${cod.toUpperCase()}_HOST`;
    expect(() => validarPedidoCopia({ hospital: cod, container: 'sante-firebird' }, env)).toThrow(
      /sante-firebird/,
    );
    expect(() => validarPedidoCopia({ hospital: cod }, { ...env, [chave]: 'sante-firebird' })).toThrow(
      /sante-firebird/,
    );
    expect(() => validarPedidoCopia({ hospital: cod }, { ...env, [chave]: '10.1.2.3' })).toThrow(
      /fora do loopback/,
    );
  });
});

describe.each(codigos)('prova dos triggers na cópia "%s"', (codigo) => {
  let alvo: DestinoAprovado;

  beforeAll(() => {
    alvo = validarPedidoCopia({ hospital: codigo, destino: 'dev' }, env);
    conferirPublicacao(alvo, listarContainers());
    const estado = lerEstadoNeutralizacao(alvo);
    if (!estado.neutralizada) {
      throw new Error(
        `${alvo.container} não está neutralizada: rode ./pnpm copia:neutralizar antes da prova.`,
      );
    }
  });

  it('RICADPAC: ID, prontuário e HTPACIENTE dentro da transação; ROLLBACK desfaz tudo', () => {
    const r = provarTriggers(alvo);
    console.log(`[${codigo}] ${alvo.container}: ${JSON.stringify(r)}`);
    expect(r.idGerado, 'ID por TRG_RICADPAC_BI').toBe(true);
    expect(r.idDoGenerator, 'ID vindo de gen_idricadpac').toBe(true);
    expect(r.unificadoIgualId, 'ID_RICADPAC_UNIFICADO = ID').toBe(true);
    expect(r.prontuarioGerado, 'PRONT gerado').toBe(true);
    expect(r.prontuarioDoTbgerseq, 'PRONT vindo de TBGERSEQ').toBe(true);
    expect(r.htpacienteDoPaciente, 'linha em HTPACIENTE por TRG_RICADPAC_AIU').toBe(1);
    expect(r.inseriuUmaLinha).toBe(true);
    expect(r.desfeito, 'ID, prontuário e HTPACIENTE sintéticos ausentes depois do ROLLBACK').toBe(true);
    expect(r.generators.gen_idricadpac, 'GEN_IDRICADPAC avança (não volta com ROLLBACK)').toBeGreaterThan(0);
    expect(r.generators.gen_id_htpaciente, 'GEN_ID_HTPACIENTE avança (não volta)').toBeGreaterThan(0);
  });

  for (const f of FUNCOES_EXTERNAS.filter((x) => x.modulo === 'ib_udf')) {
    it(`função externa ${f.nome} (ib_udf) responde por SELECT em RDB$DATABASE`, () => {
      expect(chamarFuncaoExterna(alvo, f.nome)).toEqual({ ok: true, erro: '' });
    });
  }

  // Esperado falhar: a biblioteca vlr_med do fornecedor não está na cópia (nem no sante-firebird); vem da
  // TI. Quando ela chegar, este teste passa a falhar e vira um `it` comum.
  it.fails('função externa VLR_MED (vlr_med do fornecedor; ausente até a TI entregar)', () => {
    const r = chamarFuncaoExterna(alvo, 'VLR_MED');
    console.log(`[${codigo}] VLR_MED: ${r.ok ? 'ok' : r.erro}`);
    expect(r.ok).toBe(true);
  });
});
