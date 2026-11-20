import { defineConfig } from 'vitest/config';

// Projeto "dominio-pep": regras puras do prontuário. O parser DFM é motor (cobertura ≥ 90%, cap-14 §14.2.1).
// M15: o leitor do prontuário (texto formatado, XML, respostas) também é motor de leitura (cobertura 90%).
// modelos-convertidos.spec.ts confere as representações geradas da cópia em docs/marcos/M09/dfm/.
// M22: o motor (regras, gravador, renderizador, horários e histórico) também é motor (cobertura 90%).
export default defineConfig({
  root: import.meta.dirname,
  envDir: false,
  resolve: { tsconfigPaths: true },
  test: {
    name: 'dominio-pep',
    include: ['src/**/*.spec.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: [
        'src/formulario/**/*.ts',
        'src/prontuario/**/*.ts',
        'src/regras/**/*.ts',
        'src/gravador/**/*.ts',
        'src/renderizador/**/*.ts',
        'src/horarios.ts',
        'src/historico.ts',
        'src/prescricao/**/*.ts',
        'src/alertas/**/*.ts',
        // M23: regras do prontuário de uso diário (cobertura ≥ 80% na ficha; o projeto mantém 90%).
        'src/autorizacao/**/*.ts',
        'src/alergia.ts',
        'src/receita.ts',
        'src/atestado.ts',
        'src/documento-legado.ts',
        'src/interconsulta.ts',
        'src/pedido-exame.ts',
        'src/sumario-alta.ts',
        'src/alertas-completude.ts',
        'src/sigilo-categoria.ts',
        'src/resultados.ts',
        'src/problemas.ts',
        // M45, etapa 1: construtor de formulários novos (motor: cobertura ≥ 90%).
        'src/formulario-novo/**/*.ts',
        // M45, etapa 2: índices de UTI (motor: cobertura ≥ 90%).
        'src/indices-uti/**/*.ts',
        // M45, etapa 5: nutrição e serviço social (motor de triagem, terapia e mapa: cobertura ≥ 90%).
        'src/nutricao/**/*.ts',
        'src/social/**/*.ts',
        // M45, etapa 6: especialidades sob demanda e o lactário (motores de dose, partograma e validade: 90%).
        'src/especialidades/**/*.ts',
      ],
      exclude: ['src/**/*.spec.ts', 'src/**/*.spec-util.ts'],
      reportsDirectory: '../../coverage/dominio-pep',
      reporter: ['text-summary'],
      thresholds: { lines: 90, statements: 90, functions: 90, branches: 85 },
    },
  },
});
