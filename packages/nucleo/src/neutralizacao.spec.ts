import { describe, expect, it } from 'vitest';
import {
  ErroEnvioNeutralizado,
  ambienteDe,
  ehDestinoLocal,
  ehLoopback,
  envioExternoPermitido,
  exigirEnvioExterno,
  formatarNeutralizacao,
  hostsDoValor,
  verificarNeutralizacao,
} from './neutralizacao.js';
import { ErroConfiguracao } from './erros.js';
import { NucleoProprio } from './nucleo.js';

describe('neutralização fora de produção', () => {
  it('só produção envia para fora', () => {
    expect(ambienteDe({})).toBe('dev');
    expect(envioExternoPermitido({ AMBIENTE: 'homolog' })).toBe(false);
    expect(envioExternoPermitido({ AMBIENTE: 'producao' })).toBe(true);
    expect(() => exigirEnvioExterno({ AMBIENTE: 'treino' }, 'whatsapp')).toThrow(ErroEnvioNeutralizado);
    expect(() => exigirEnvioExterno({ AMBIENTE: 'producao' }, 'whatsapp')).not.toThrow();
    expect(() => ambienteDe({ AMBIENTE: 'qualquer' })).toThrow(/AMBIENTE/);
  });

  it('reconhece destinos locais', () => {
    expect(ehLoopback('127.0.0.1')).toBe(true);
    expect(ehLoopback('[::1]')).toBe(true);
    expect(ehLoopback('10.0.0.1')).toBe(false);
    expect(ehDestinoLocal('tiss.invalid')).toBe(true);
    expect(ehDestinoLocal('sgh-mailpit')).toBe(false);
    expect(ehDestinoLocal('sgh-mailpit', ['sgh-mailpit'])).toBe(true);
    expect(ehDestinoLocal('api.operadora.com.br')).toBe(false);
    expect(hostsDoValor('https://a.example/x, b.test:8080')).toEqual(['a.example', 'b.test']);
  });

  it('configuração neutralizada passa; endereço externo, SMTP real e canal ligado falham citando só a chave', () => {
    const ok = verificarNeutralizacao({
      AMBIENTE: 'dev',
      SMTP_HOST: '127.0.0.1',
      TISS_URL: 'https://tiss.invalid/ws',
      WHATSAPP_HABILITADO: 'nao',
    });
    expect(ok.ok).toBe(true);
    const ruim = verificarNeutralizacao({
      SMTP_HOST: 'smtp.provedor.com',
      LABORATORIO_URL: 'https://lab.exemplo.com.br/api?token=SEGREDO',
      SMS_ATIVO: 'sim',
      WHATSAPP_TOKEN: 'SEGREDO',
      SGH_MARIADB_HOST: '10.1.1.1',
    });
    expect(ruim.ok).toBe(false);
    expect(ruim.itens.filter((i) => !i.ok).map((i) => i.regra)).toHaveLength(4);
    const texto = formatarNeutralizacao(ruim);
    expect(texto).toContain('LABORATORIO_URL');
    expect(texto).toContain('SMS_ATIVO');
    expect(texto).not.toContain('SEGREDO');
    expect(texto).not.toContain('lab.exemplo');
    const prod = verificarNeutralizacao({ AMBIENTE: 'producao', SMTP_HOST: 'smtp.provedor.com' });
    expect(prod).toMatchObject({ aplicavel: false, ok: true });
    expect(formatarNeutralizacao(prod)).toMatch(/não se aplica/);
  });

  it('IP em hexadecimal ou decimal sem ponto e nome sem ponto fora da lista não são destino local', () => {
    for (const h of ['0x08080808', '0X8080808', '134744072', '010', 'intranet'])
      expect(ehDestinoLocal(h, ['intranet2']), h).toBe(false);
    expect(ehDestinoLocal('0x08080808', ['0x08080808'])).toBe(false);
    const r = verificarNeutralizacao({
      AMBIENTE: 'dev',
      SMTP_HOST: '0x08080808',
      LAB_HOST: '0x08080808:25',
      TISS_URI: 'soap://ws.operadora.com.br/tiss',
      GOVERNO_WSDL: 'https://ws.governo.gov.br/x?wsdl',
      FILA_DSN: 'amqp://fila.externa.com.br',
      TWILIO_AUTH_TOKEN: 'SEGREDO',
      SGH_CONTAINERS_LOCAIS: 'sgh-mailpit',
      OUTRO_HOST: 'sgh-mailpit:1025',
    });
    const texto = formatarNeutralizacao(r);
    for (const k of ['SMTP_HOST', 'LAB_HOST', 'TISS_URI', 'GOVERNO_WSDL', 'FILA_DSN', 'TWILIO_AUTH_TOKEN'])
      expect(texto).toContain(k);
    expect(texto).not.toContain('OUTRO_HOST');
    expect(texto).not.toContain('SEGREDO');
  });

  it('o NucleoProprio não sobe fora de produção com a configuração não neutralizada', () => {
    const criar = () => new NucleoProprio({ env: { AMBIENTE: 'dev', SMTP_HOST: '0x08080808' } });
    expect(criar).toThrow(ErroConfiguracao);
    expect(criar).toThrow(/SMTP_HOST/);
    expect(() => new NucleoProprio({ env: { AMBIENTE: 'homolog', WHATSAPP_HABILITADO: 'sim' } })).toThrow(
      /o processo não sobe/,
    );
  });
});
