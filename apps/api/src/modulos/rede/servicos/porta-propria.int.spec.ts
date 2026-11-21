// Integração da porta própria dos serviços compartilhados da Rede no cliente de teste da onda 2 (f22_o2): as tabelas do
// registro entraram no modelo na integração da onda 2 (02_ADM/06), mas a porta sobre elas ainda não foi escrita
// (pendência do módulo rede); até lá ela recusa com 501 em tudo — também pela lista do serviço, que não confunde a
// recusa com um estabelecimento fora do ar. Nada é lido nem gravado.
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { esquemaConsultaServicosRede } from '@sgh/contratos';
import { NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PortaServicosRedePropria } from './porta-propria.js';
import { ServicoServicosRede } from './servico.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o2';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';

describe.skipIf(SEM_BANCO)('porta própria dos serviços compartilhados (cliente f22_o2)', () => {
  let nucleo: NucleoProprio;
  beforeAll(() => {
    nucleo = new NucleoProprio();
  });
  afterAll(async () => {
    await nucleo?.encerrar();
  });

  it('tabelas no modelo, porta ainda pendente: 501 pendente-modelo-proprio em todas as chamadas', async () => {
    const [x] = await nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'teste-f22l0213-servicos' }, (l) =>
      l.consultar<{ n: unknown }>(
        `SELECT COUNT(*) AS n FROM information_schema.tables
         WHERE table_schema = DATABASE() AND table_name IN ('servico_compartilhado_rede', 'servico_compartilhado_rede_estabelecimento')`,
      ),
    );
    expect(Number(x?.n)).toBe(2);
    const p = new PortaServicosRedePropria();
    const c = { rede: 'rede-f22-0213', hospital: 'f0213a' };
    const pendente = { problema: { status: 501, codigo: 'pendente-modelo-proprio' } };
    await expect(p.listar()).rejects.toMatchObject(pendente);
    await expect(p.ler()).rejects.toMatchObject(pendente);
    await expect(p.registrar()).rejects.toMatchObject(pendente);
    await expect(p.alterar()).rejects.toMatchObject(pendente);
    const servico = new ServicoServicosRede(p, {
      redeConfigurada: () => c.rede,
      estabelecimentos: () => [{ codigo: c.hospital, nome: 'Hospital sintético' }],
    });
    await expect(
      servico.listar(
        {
          ...c,
          login: 'F22L0213.GESTOR',
          como: false,
          liberados: new Set([c.hospital]),
          trilha: () => {
            throw new Error('Nenhuma gravação neste teste.');
          },
        },
        esquemaConsultaServicosRede.parse({}),
      ),
    ).rejects.toMatchObject(pendente);
  });
});
