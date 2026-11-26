<script setup lang="ts">
// Regras de crítica das contas recebidas (08-SGO L105, C1-100; rota /operadora/regras-critica-conta, atalho da tela das
// contas médicas): as regras próprias da operadora que o recebimento do lote aplica a cada guia (procedimentos que não
// se cobram juntos, combinação rejeitada, glosa de referência do procedimento e penalidade do prestador), com a glosa
// automática quando a regra pede. Validação do domínio na hora (os mesmos problemas que o servidor recusa); a regra
// nunca é apagada: sai de uso e pode voltar, com a trilha. Ler com operadora.conta.ler; gravar com
// operadora.conta.analisar.
import {
  type EntradaRegraCritica,
  problemasDaRegraCritica,
  ROTULOS_REGRA_CRITICA,
  TIPOS_REGRA_CRITICA,
  type TipoRegraCritica,
} from '@sgh/dominio-operadora';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteData, SanteSelecao } from '@sgh/ui';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { ErroApi } from '../../../casca/erros/problem-details.js';
import { pode } from '../../../casca/sessao/pode.js';
import {
  type ApoioRegras,
  incluirRegraCritica,
  lerApoioRegras,
  lerRegrasCritica,
  type RegraCritica,
  situacaoRegraCritica,
} from '../api-conferencia-conta.js';
import { lerApoioContas } from '../api-contas.js';
import { mensagensConferenciaConta } from '../i18n-conferencia-conta.js';

const { t } = useI18n({ useScope: 'local', messages: { 'pt-BR': mensagensConferenciaConta } });

const podeGravar = computed(() => pode('operadora.conta.analisar'));
const erro = ref<string | null>(null);
const aviso = ref<string | null>(null);
const operadoras = ref<{ valor: number | null; rotulo: string }[]>([]);
const operadora = ref<number | null>(null);
const apoio = ref<ApoioRegras>({ procedimentos: [], motivos: [], prestadores: [] });
const regras = ref<RegraCritica[] | null>(null);
const gravando = ref(false);

const hojeIso = () => new Date().toISOString().slice(0, 10);
const nova = reactive({
  codigo: '',
  descricao: '',
  tipo: 'auto_excludente' as TipoRegraCritica | null,
  principal: null as number | null,
  relacionado: null as number | null,
  prestador: null as number | null,
  motivoGlosa: null as number | null,
  percentual: '',
  glosaAutomatica: 'nao' as 'sim' | 'nao' | null,
  inicio: hojeIso() as string | null,
  fim: null as string | null,
});

const dataBr = (v: string | null) => (v ? v.split('-').reverse().join('/') : '—');
const numeroBr = (v: string): number | null => {
  const x = v.trim().replace(/\./g, '').replace(',', '.');
  return x === '' || Number.isNaN(Number(x)) ? null : Number(x);
};
const comVazio = (xs: { valor: number; rotulo: string }[]) => [
  { valor: null as number | null, rotulo: t('regras.nenhum') },
  ...xs.map((o) => ({ valor: o.valor as number | null, rotulo: o.rotulo })),
];
const TIPOS = TIPOS_REGRA_CRITICA.map((v) => ({ valor: v, rotulo: ROTULOS_REGRA_CRITICA[v] }));
const SIM_NAO = computed(() => [
  { valor: 'nao' as const, rotulo: t('regras.nao') },
  { valor: 'sim' as const, rotulo: t('regras.sim') },
]);
const procedimentos = computed(() =>
  comVazio(apoio.value.procedimentos.map((p) => ({ valor: p.id, rotulo: `${p.codigo} · ${p.descricao}` }))),
);
const motivos = computed(() =>
  comVazio(apoio.value.motivos.map((m) => ({ valor: m.id, rotulo: `${m.codigo} · ${m.descricao}` }))),
);
const prestadores = computed(() =>
  comVazio(apoio.value.prestadores.map((p) => ({ valor: p.id, rotulo: p.nome }))),
);
const usaPar = computed(() => nova.tipo === 'auto_excludente' || nova.tipo === 'combinacao_rejeitada');
const usaProcedimento = computed(() => nova.tipo !== 'penalidade_prestador');

async function tentar<T>(fn: () => Promise<T>, ok?: string): Promise<T | null> {
  erro.value = null;
  aviso.value = null;
  try {
    const r = await fn();
    if (ok) aviso.value = ok;
    return r;
  } catch (e) {
    erro.value = e instanceof ErroApi && e.problema?.detail ? e.problema.detail : String(e);
    return null;
  }
}

void tentar(async () => {
  const a = await lerApoioContas();
  operadoras.value = a.operadoras.map((o) => ({ valor: o.id, rotulo: `${o.nome} (${o.registroAns})` }));
  if (a.operadoras.length === 1) operadora.value = a.operadoras[0]!.id;
});
/** Recarrega a lista sem apagar o aviso da gravação que a pediu (só o erro da leitura substitui o aviso). */
async function carregar(op: number): Promise<void> {
  const avisoAnterior = aviso.value;
  regras.value = (await tentar(() => lerRegrasCritica(op))) ?? [];
  if (!erro.value) aviso.value = avisoAnterior;
}
watch(operadora, async (op) => {
  regras.value = null;
  if (!op) return;
  apoio.value = (await tentar(() => lerApoioRegras(op))) ?? apoio.value;
  await carregar(op);
});
watch(
  () => nova.tipo,
  () => {
    if (!usaPar.value) nova.relacionado = null;
    if (!usaProcedimento.value) nova.principal = null;
  },
);

const entrada = computed<EntradaRegraCritica>(() => ({
  codigo: nova.codigo,
  descricao: nova.descricao.trim(),
  tipo: nova.tipo ?? 'auto_excludente',
  principal: nova.principal,
  relacionado: nova.relacionado,
  prestador: nova.prestador,
  motivoGlosa: nova.motivoGlosa,
  percentual: numeroBr(nova.percentual),
  glosaAutomatica: nova.glosaAutomatica === 'sim',
  vigenciaInicio: nova.inicio ?? '',
  vigenciaFim: nova.fim,
}));
/** A mesma validação do servidor, na hora, com os códigos já cadastrados na operadora. */
const falta = computed(() => {
  const textos = problemasDaRegraCritica(
    entrada.value,
    (regras.value ?? []).map((r) => r.codigo),
  ).map((p) => t(`regras.problemas.${p.codigo}`));
  if (nova.tipo === null) textos.unshift(t('regras.problemas.tipo-invalido'));
  return [...new Set(textos)];
});

async function salvar(): Promise<void> {
  const op = operadora.value;
  if (!op || falta.value.length || gravando.value) return;
  gravando.value = true;
  const r = await tentar(() => incluirRegraCritica(op, entrada.value), t('regras.cadastrada'));
  gravando.value = false;
  if (!r) return;
  Object.assign(nova, {
    codigo: '',
    descricao: '',
    principal: null,
    relacionado: null,
    prestador: null,
    motivoGlosa: null,
    percentual: '',
    glosaAutomatica: 'nao',
    fim: null,
  });
  await carregar(op);
}
async function alternar(r: RegraCritica): Promise<void> {
  const op = operadora.value;
  if (!op) return;
  const ok = await tentar(() => situacaoRegraCritica(r.id, r.versao, !r.ativo), t('regras.alterada'));
  if (ok) await carregar(op);
}
</script>

<template>
  <section
    class="regras-critica"
    aria-labelledby="regras-critica-titulo"
    data-testid="tela-regras-critica-conta"
  >
    <h1 id="regras-critica-titulo">{{ t('regras.titulo') }}</h1>
    <p class="regras-critica__ajuda">{{ t('regras.texto') }}</p>
    <p>
      <RouterLink to="/operadora/contas" data-testid="regras-critica-voltar">{{
        t('regras.voltarContas')
      }}</RouterLink>
    </p>
    <SanteAlerta v-if="erro" :texto="erro" variante="alerta" data-testid="regras-critica-erro" />
    <SanteAlerta v-if="aviso" :texto="aviso" variante="info" data-testid="regras-critica-aviso" />

    <SanteSelecao
      id="regras-critica-operadora"
      v-model="operadora"
      :rotulo="t('regras.operadora')"
      :opcoes="operadoras"
      data-testid="regras-critica-operadora"
    />

    <template v-if="operadora">
      <p v-if="regras === null" role="status">{{ t('regras.carregando') }}</p>
      <p v-else-if="!regras.length" data-testid="regras-critica-vazia">{{ t('regras.nenhuma') }}</p>
      <table v-else class="regras-critica__tabela" data-testid="regras-critica-lista">
        <thead>
          <tr>
            <th>{{ t('regras.codigo') }}</th>
            <th>{{ t('regras.tipo') }}</th>
            <th>{{ t('regras.principal') }}</th>
            <th>{{ t('regras.relacionado') }}</th>
            <th>{{ t('regras.prestador') }}</th>
            <th>{{ t('regras.motivo') }}</th>
            <th>{{ t('regras.percentual') }}</th>
            <th>{{ t('regras.vigencia') }}</th>
            <th>{{ t('regras.situacao') }}</th>
            <th v-if="podeGravar"></th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="r in regras"
            :key="r.id"
            :data-testid="`regras-critica-${r.codigo}`"
            :data-ativa="r.ativo ? 'sim' : 'nao'"
          >
            <td>
              <strong>{{ r.codigo }}</strong
              ><br /><span class="regras-critica__ajuda">{{ r.descricao }}</span>
            </td>
            <td>{{ ROTULOS_REGRA_CRITICA[r.tipo] }}</td>
            <td>{{ r.principal ? `${r.principal.codigo} · ${r.principal.descricao}` : '—' }}</td>
            <td>{{ r.relacionado ? `${r.relacionado.codigo} · ${r.relacionado.descricao}` : '—' }}</td>
            <td>{{ r.prestador?.nome ?? '—' }}</td>
            <td>
              {{
                r.motivoGlosa
                  ? `${r.motivoGlosa.codigo}${r.glosaAutomatica ? ` (${t('regras.automatica')})` : ''}`
                  : '—'
              }}
            </td>
            <td>{{ r.percentual ?? '—' }}</td>
            <td>{{ `${dataBr(r.vigenciaInicio)} – ${dataBr(r.vigenciaFim)}` }}</td>
            <td>{{ r.ativo ? t('regras.ativa') : t('regras.inativa') }}</td>
            <td v-if="podeGravar">
              <SanteBotao
                variante="texto"
                :rotulo="r.ativo ? t('regras.tirarDeUso') : t('regras.voltarAoUso')"
                :data-testid="`regras-critica-alternar-${r.codigo}`"
                @acionar="alternar(r)"
              />
            </td>
          </tr>
        </tbody>
      </table>

      <form
        v-if="podeGravar"
        class="regras-critica__cartao"
        data-testid="regras-critica-nova"
        @submit.prevent="salvar"
      >
        <h2>{{ t('regras.nova') }}</h2>
        <div class="regras-critica__linha">
          <SanteCampoTexto
            id="regras-critica-codigo"
            v-model="nova.codigo"
            :max-bytes="30"
            :rotulo="t('regras.codigo')"
            obrigatorio
            data-testid="regras-critica-codigo"
          />
          <SanteCampoTexto
            id="regras-critica-descricao"
            v-model="nova.descricao"
            :max-bytes="150"
            :rotulo="t('regras.descricao')"
            obrigatorio
            data-testid="regras-critica-descricao"
          />
          <SanteSelecao
            id="regras-critica-tipo"
            v-model="nova.tipo"
            :rotulo="t('regras.tipo')"
            :opcoes="TIPOS"
            obrigatorio
            data-testid="regras-critica-tipo"
          />
        </div>
        <div class="regras-critica__linha">
          <SanteSelecao
            v-if="usaProcedimento"
            id="regras-critica-principal"
            v-model="nova.principal"
            :rotulo="t('regras.principal')"
            :opcoes="procedimentos"
            data-testid="regras-critica-principal"
          />
          <SanteSelecao
            v-if="usaPar"
            id="regras-critica-relacionado"
            v-model="nova.relacionado"
            :rotulo="t('regras.relacionado')"
            :opcoes="procedimentos"
            data-testid="regras-critica-relacionado"
          />
          <SanteSelecao
            id="regras-critica-prestador"
            v-model="nova.prestador"
            :rotulo="t('regras.prestador')"
            :opcoes="prestadores"
            data-testid="regras-critica-prestador"
          />
        </div>
        <div class="regras-critica__linha">
          <SanteSelecao
            id="regras-critica-glosa-automatica"
            v-model="nova.glosaAutomatica"
            :rotulo="t('regras.glosaAutomatica')"
            :opcoes="SIM_NAO"
            data-testid="regras-critica-glosa-automatica"
          />
          <SanteSelecao
            id="regras-critica-motivo"
            v-model="nova.motivoGlosa"
            :rotulo="t('regras.motivo')"
            :opcoes="motivos"
            data-testid="regras-critica-motivo"
          />
          <SanteCampoTexto
            id="regras-critica-percentual"
            v-model="nova.percentual"
            :max-bytes="6"
            :rotulo="t('regras.percentual')"
            data-testid="regras-critica-percentual"
          />
        </div>
        <div class="regras-critica__linha">
          <SanteData
            v-model="nova.inicio"
            :rotulo="t('regras.inicio')"
            editavel
            data-testid="regras-critica-inicio"
          />
          <SanteData v-model="nova.fim" :rotulo="t('regras.fim')" editavel data-testid="regras-critica-fim" />
        </div>
        <p v-if="falta.length" class="regras-critica__erro" data-testid="regras-critica-falta">
          {{ t('regras.falta', { itens: falta.join('; ') }) }}
        </p>
        <SanteBotao
          :rotulo="t('regras.cadastrar')"
          tipo="submit"
          :desabilitado="falta.length > 0 || gravando"
          data-testid="regras-critica-salvar"
        />
      </form>
    </template>
  </section>
</template>

<style scoped>
.regras-critica,
.regras-critica__cartao {
  display: flex;
  flex-direction: column;
  gap: var(--sgh-espaco-2);
}
.regras-critica__linha {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  align-items: flex-end;
}
.regras-critica__ajuda {
  color: var(--sgh-texto-secundario);
}
.regras-critica__erro {
  color: var(--sgh-alerta);
}
.regras-critica__cartao {
  padding: var(--sgh-espaco-2);
  border: 1px solid var(--sgh-borda);
}
.regras-critica__tabela {
  width: 100%;
  border-collapse: collapse;
}
.regras-critica__tabela th,
.regras-critica__tabela td {
  text-align: left;
  padding: var(--sgh-espaco-1);
  border-bottom: 1px solid var(--sgh-borda);
}
</style>
