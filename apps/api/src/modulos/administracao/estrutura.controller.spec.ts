// Cache da estrutura (ADR 0011): a chave leva a rede e o estabelecimento; duas redes com o mesmo código de
// estabelecimento nunca dividem a entrada (uma rede não enxerga a empresa, o hospital e as unidades da outra).
// Fonte falsa em memória; nada conecta a banco.
import { describe, expect, it } from 'vitest';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import type { ResolvedorSessao } from '../../autorizacao/resolvedor-sessao.js';
import { EstruturaController } from './estrutura.controller.js';
import type { Ctx, FonteAdministracao } from './fonte.js';

function req(rede: string, hospital = 'pc'): RequisicaoAutorizada {
  return {
    headers: {},
    sgh: {
      sessao: {
        rede,
        estabelecimentoAtivo: hospital,
        usuario: { login: 'SINT.ADMIN' },
        permissoes: [],
      },
    },
  } as unknown as RequisicaoAutorizada;
}

describe('estrutura: cache por rede e estabelecimento', () => {
  it('duas redes com o mesmo estabelecimento leem cada uma a sua estrutura; a mesma rede usa o cache', async () => {
    const lidas: string[] = [];
    const fonte = {
      destino: 'banco',
      estrutura: async (c: Ctx) => {
        lidas.push(`${c.rede}/${c.hospital}`);
        return {
          empresa: null,
          hospital: {
            codigo: 1,
            nome: `Hospital da ${c.rede}`,
            cnes: null,
            cnpj: null,
            municipio: null,
            uf: null,
            esfera: null,
            complexidade: null,
            fusoHorario: null,
          },
          unidades: [],
        };
      },
    } as unknown as FonteAdministracao;
    const ctl = new EstruturaController(fonte, null, {} as ResolvedorSessao);
    const a = await ctl.estrutura(req('rede-a'));
    const b = await ctl.estrutura(req('rede-b'));
    const a2 = await ctl.estrutura(req('rede-a'));
    expect(a.hospital?.nome).toBe('Hospital da rede-a');
    expect(b.hospital?.nome).toBe('Hospital da rede-b');
    expect(a2.hospital?.nome).toBe('Hospital da rede-a');
    expect(lidas).toEqual(['rede-a/pc', 'rede-b/pc']);
  });
});
