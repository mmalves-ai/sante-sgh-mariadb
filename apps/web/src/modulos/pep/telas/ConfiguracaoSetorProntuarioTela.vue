<script setup lang="ts">
// Regras do prontuário por setor e tipo de atendimento (F3.3, linha 03-PEP L91): registro retroativo com tolerância,
// assinatura exigida e evoluções exigidas antes de prescrever. Uma grade com todas as configurações do
// estabelecimento, editável na linha; a tolerância só abre com o retroativo ligado (validação na hora, a mesma regra
// do domínio na API). Sem configuração do setor vale a do setor para "todos", senão o padrão do estabelecimento.
// Ler exige pep.admin.ler; gravar, pep.admin.editar.
import { SanteAlerta, SanteSelecao } from '@sgh/ui';
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  type ConfiguracaoSetor,
  gravarConfiguracaoSetor,
  lerConfiguracoesSetor,
  type TipoAtendimento,
} from '../api-equipe-painel.js';

const { t } = useI18n();
const TIPOS: TipoAtendimento[] = [
  'todos',
  'internacao',
  'pronto_atendimento',
  'ambulatorio',
  'hospital_dia',
  'externo',
];
const itens = ref<ConfiguracaoSetor[]>([]);
const setores = ref<{ id: number; nome: string }[]>([]);
const erro = ref<string | null>(null);
const salvo = ref<string | null>(null);
const nova = ref<ConfiguracaoSetor>(vazia());

function vazia(): ConfiguracaoSetor {
  return {
    setor: 0,
    tipoAtendimento: 'todos',
    permiteRetroativo: false,
    toleranciaRetroativoHoras: null,
    assinaturaExigida: 'eletronica',
    exigeEvolucaoMedica: false,
    exigeEvolucaoEnfermagem: false,
    ativo: true,
    versao: null,
  };
}
/** A mesma regra do domínio, na hora: tolerância só com retroativo, de 1 a 720 h. */
function problema(c: ConfiguracaoSetor): string | null {
  if (!c.setor) return t('pep.equipe.setor.escolhaSetor');
  const tol = c.toleranciaRetroativoHoras;
  if (!c.permiteRetroativo && tol !== null) return t('pep.equipe.setor.toleranciaSemRetroativo');
  if (tol !== null && (!Number.isInteger(tol) || tol < 1 || tol > 720))
    return t('pep.equipe.setor.toleranciaFora');
  return null;
}
const problemaNova = computed(() => problema(nova.value));
const opcoesSetor = computed(() => [
  { valor: 0, rotulo: t('pep.equipe.setor.escolha'), desabilitada: true },
  ...setores.value.map((s) => ({ valor: s.id, rotulo: s.nome })),
]);
const opcoesTipo = computed(() => TIPOS.map((x) => ({ valor: x, rotulo: t(`pep.equipe.setor.tipos.${x}`) })));
const opcoesAssinatura = computed(() =>
  (['nenhuma', 'eletronica', 'digital_icp'] as const).map((x) => ({
    valor: x,
    rotulo: t(`pep.equipe.setor.assinaturas.${x}`),
  })),
);

async function carregar(): Promise<void> {
  try {
    const r = await lerConfiguracoesSetor();
    itens.value = r.itens;
    setores.value = r.setores;
  } catch (x) {
    erro.value = x instanceof Error ? x.message : String(x);
  }
}
async function salvar(c: ConfiguracaoSetor): Promise<void> {
  if (problema(c)) return;
  try {
    erro.value = null;
    await gravarConfiguracaoSetor(c);
    salvo.value = t('pep.equipe.setor.gravada');
    if (c === nova.value) nova.value = vazia();
    await carregar();
  } catch (x) {
    erro.value = x instanceof Error ? x.message : String(x);
    // Conflito de versão (outro gravou antes): recarrega para alterar a partir do que está gravado.
    await carregar();
  }
}
function retroativo(c: ConfiguracaoSetor, v: boolean): void {
  c.permiteRetroativo = v;
  if (!v) c.toleranciaRetroativoHoras = null;
}
const tolerancia = (v: string): number | null => (v.trim() === '' ? null : Number(v));
onMounted(carregar);
</script>

<template>
  <section class="cfg" data-testid="config-setor-prontuario">
    <h1>{{ t('pep.equipe.setor.titulo') }}</h1>
    <SanteAlerta v-if="erro" :texto="erro" data-testid="cfg-erro" />
    <p v-if="salvo" role="status">{{ salvo }}</p>
    <table>
      <thead>
        <tr>
          <th scope="col">{{ t('pep.equipe.setor.setor') }}</th>
          <th scope="col">{{ t('pep.equipe.setor.atendimento') }}</th>
          <th scope="col">{{ t('pep.equipe.setor.retroativo') }}</th>
          <th scope="col">{{ t('pep.equipe.setor.tolerancia') }}</th>
          <th scope="col">{{ t('pep.equipe.setor.assinatura') }}</th>
          <th scope="col">{{ t('pep.equipe.setor.evolucaoMedica') }}</th>
          <th scope="col">{{ t('pep.equipe.setor.evolucaoEnfermagem') }}</th>
          <th scope="col">{{ t('pep.equipe.setor.ativa') }}</th>
          <th scope="col">
            <span class="sr">{{ t('pep.equipe.setor.gravar') }}</span>
          </th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="c in [...itens, nova]"
          :key="c.id ?? 'nova'"
          :data-testid="c.id ? `cfg-linha-${c.id}` : 'cfg-nova'"
        >
          <td>
            <span v-if="c.id">{{ c.setorNome }}</span>
            <SanteSelecao
              v-else
              v-model="c.setor"
              ocultar-rotulo
              :rotulo="t('pep.equipe.setor.setor')"
              :opcoes="opcoesSetor"
              data-testid="cfg-setor"
            />
          </td>
          <td>
            <span v-if="c.id">{{ t(`pep.equipe.setor.tipos.${c.tipoAtendimento}`) }}</span>
            <SanteSelecao
              v-else
              v-model="c.tipoAtendimento"
              ocultar-rotulo
              :rotulo="t('pep.equipe.setor.atendimento')"
              :opcoes="opcoesTipo"
              data-testid="cfg-tipo"
            />
          </td>
          <td>
            <input
              type="checkbox"
              :checked="c.permiteRetroativo"
              :aria-label="t('pep.equipe.setor.retroativo')"
              data-testid="cfg-retroativo"
              @change="retroativo(c, ($event.target as HTMLInputElement).checked)"
            />
          </td>
          <td>
            <input
              :value="c.toleranciaRetroativoHoras ?? ''"
              :disabled="!c.permiteRetroativo"
              inputmode="numeric"
              size="4"
              :aria-label="t('pep.equipe.setor.tolerancia')"
              data-testid="cfg-tolerancia"
              @input="c.toleranciaRetroativoHoras = tolerancia(($event.target as HTMLInputElement).value)"
            />
          </td>
          <td>
            <SanteSelecao
              v-model="c.assinaturaExigida"
              ocultar-rotulo
              :rotulo="t('pep.equipe.setor.assinatura')"
              :opcoes="opcoesAssinatura"
              data-testid="cfg-assinatura"
            />
          </td>
          <td>
            <input
              v-model="c.exigeEvolucaoMedica"
              type="checkbox"
              :aria-label="t('pep.equipe.setor.evolucaoMedica')"
            />
          </td>
          <td>
            <input
              v-model="c.exigeEvolucaoEnfermagem"
              type="checkbox"
              :aria-label="t('pep.equipe.setor.evolucaoEnfermagem')"
            />
          </td>
          <td><input v-model="c.ativo" type="checkbox" :aria-label="t('pep.equipe.setor.ativa')" /></td>
          <td>
            <button type="button" :disabled="!!problema(c)" data-testid="cfg-gravar" @click="salvar(c)">
              {{ c.id ? t('pep.equipe.setor.gravar') : t('pep.equipe.setor.incluir') }}
            </button>
            <small v-if="problema(c) && (c.id || c.setor)" role="status">{{ problema(c) }}</small>
          </td>
        </tr>
      </tbody>
    </table>
    <p v-if="problemaNova && nova.setor" class="dica">{{ problemaNova }}</p>
  </section>
</template>

<style scoped>
.cfg table {
  width: 100%;
  border-collapse: collapse;
}
.cfg th,
.cfg td {
  text-align: left;
  padding: 0.25rem 0.5rem;
}
.sr {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
}
</style>
