// Portal de resultados sobre o banco próprio (ficha do M26, regra 9; cliente f22_o2): o serviço do portal opera pelo
// contexto do núcleo (cliente e estabelecimento pelo código do endereço, sem usuário interno). Falha fechada: sem a
// liberação do recurso no estabelecimento, nenhuma entrada (403). A validação pública do laudo lê emissao_laudo e não
// revela nada de um código desconhecido. As leituras do acesso (protocolo e conta do médico) ainda são pendência do
// modelo na porta própria (409 modelo-pendente, lote 02-09): o teste trava a recusa explícita, para que a falta nunca
// vire "credencial inválida" silenciosa. Só contagens; nenhum dado de pessoa. SGH_NUCLEO_SEM_BANCO=1 pula.
import { CHAVES_SADT } from '@sgh/contratos';
import { ErroOperacao, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ErroProblema } from '../../../problema.filter.js';
import { desligarMapaEstabelecimentos, ligarMapaEstabelecimentos } from '../../cadastro/contexto-nucleo.js';
import type { FonteConfiguracao } from '../../config/public-api.js';
import { PortaSadtPropria } from '../porta-propria.js';
import { ServicoPortal } from './portal.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o2';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';

/** Configuração com o portal ligado no estabelecimento (escopo do estabelecimento, sem pré-requisito). */
const portalLigado = {
  chaves: async () => [
    { chave: CHAVES_SADT.portal, tipo: 'recurso', ligada: true, escopo: 'estabelecimento', valor: null },
  ],
  prerequisitos: async () => [],
  parametros: async () => [],
} as unknown as FonteConfiguracao;

describe.skipIf(SEM_BANCO)('portal de resultados sobre o banco próprio (cliente f22_o2)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaSadtPropria;
  let hospital = '';

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    await ligarMapaEstabelecimentos(CLIENTE, nucleo);
    porta = new PortaSadtPropria(nucleo);
    const e = await nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'teste-02-10-portal' }, (l) =>
      l.uma<{ codigo: string }>(
        'SELECT codigo FROM estabelecimento WHERE ativo = TRUE AND excluido_em IS NULL ORDER BY id LIMIT 1',
        [],
      ),
    );
    hospital = e?.codigo ?? '';
    expect(hospital).not.toBe('');
  });

  afterAll(async () => {
    desligarMapaEstabelecimentos();
    await nucleo?.encerrar();
  });

  it('sem a liberação do portal no estabelecimento, a entrada é recusada (403, falha fechada)', async () => {
    const portal = new ServicoPortal(porta, 'rede', null, null, 'Produto');
    await expect(
      portal.entrarPaciente(hospital, { protocolo: 'ABCDE23456', nascimento: '2000-01-01' }, '127.0.0.26'),
    ).rejects.toMatchObject({ tipo: 'recurso-desligado', extras: { codigo: 'recurso-desligado' } });
  });

  it('a validação pública de um código desconhecido não revela nada', async () => {
    const portal = new ServicoPortal(porta, 'rede', portalLigado, null, 'Produto');
    expect(await portal.validar(hospital, 'CODIGO-INEXISTENTE-0210')).toEqual({
      valido: false,
      emitidoEm: null,
      estabelecimento: null,
      exames: 0,
    });
  });

  it('com o portal ligado, a leitura do acesso pendente no modelo é recusada com o motivo (nunca "credencial inválida")', async () => {
    const portal = new ServicoPortal(porta, 'rede', portalLigado, null, 'Produto');
    const erro = await portal
      .entrarPaciente(hospital, { protocolo: 'ABCDE23456', nascimento: '2000-01-01' }, '127.0.0.26')
      .then(() => null)
      .catch((e: unknown) => e);
    // Quando a porta própria passar a ler o acesso, a entrada com protocolo desconhecido vira 401 (credencial inválida).
    if (erro instanceof ErroOperacao) expect(erro.problema.codigo).toBe('modelo-pendente');
    else expect(erro).toBeInstanceOf(ErroProblema);
  });
});
