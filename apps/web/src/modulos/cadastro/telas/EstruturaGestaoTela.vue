<script setup lang="ts">
// Estrutura do estabelecimento (F3.1, 02-CAD linhas 26 e 27): dados do estabelecimento, unidades assistenciais e
// setores com os ramais, numa tela só por abas. O setor é editado com os ramais no mesmo formulário (uma gravação);
// a árvore mostra o superior; o CNPJ e a regra "lança na conta exige centro de custo" são conferidos na hora.
// Inativar pede motivo e nunca apaga. A recusa da API aparece junto do formulário.
import { SanteBotao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import {
  alterarEstabelecimento,
  buscarProfissionais,
  type Corpo,
  gravarSetor,
  gravarUnidade,
  lerEstrutura,
  type Opcao,
  type Ramal,
  type Setor,
  situacaoSetor,
  situacaoUnidade,
  type Unidade,
} from '../api-estrutura.js';

const { t } = useI18n();
const cliente = useQueryClient();
const consulta = useQuery({ queryKey: ['cadastro', 'estrutura-gestao'], queryFn: lerEstrutura });
const dados = computed(() => consulta.data.value);
const aba = ref<'estabelecimento' | 'unidades' | 'setores'>('estabelecimento');
const erro = ref<unknown>(null);
const ok = ref(false);

async function fazer(fn: () => Promise<unknown>, depois?: () => void): Promise<void> {
  erro.value = null;
  ok.value = false;
  try {
    await fn();
    ok.value = true;
    depois?.();
    await cliente.invalidateQueries({ queryKey: ['cadastro', 'estrutura-gestao'] });
  } catch (e) {
    erro.value = e;
  }
}

// Validação na hora (a mesma regra do domínio volta da API se passar).
function cnpjConfere(c: string): boolean {
  if (!/^\d{14}$/.test(c) || /^(\d)\1{13}$/.test(c)) return false;
  const dv = (b: string) => {
    let s = 0;
    let p = b.length - 7;
    for (const x of b) {
      s += Number(x) * p;
      p = p === 2 ? 9 : p - 1;
    }
    const r = s % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const d1 = dv(c.slice(0, 12));
  return c.endsWith(`${d1}${dv(c.slice(0, 12) + d1)}`);
}
const so = (v: unknown) => String(v ?? '').replace(/\D+/g, '');

// ── Estabelecimento ──
const est = ref<Corpo>({});
watch(dados, (d) => d && (est.value = { ...d.estabelecimento }), { immediate: true });
const cnpjRuim = computed(() => so(est.value['cnpj']) !== '' && !cnpjConfere(so(est.value['cnpj'])));
const CAMPOS_EST = [
  'razaoSocial',
  'nomeFantasia',
  'cnpj',
  'inscricaoEstadual',
  'inscricaoMunicipal',
  'cnes',
  'cep',
  'logradouro',
  'numero',
  'complemento',
  'bairro',
  'telefone',
  'email',
  'site',
] as const;

// ── Unidades ──
const tiposUnidade = [
  'ambulatorio',
  'pronto_atendimento',
  'internacao',
  'diagnostico',
  'centro_cirurgico',
  'hospital_dia',
  'atencao_domiciliar',
  'outra',
];
const unidade = ref<Corpo | null>(null);
const novaUnidade = (): Corpo => ({ id: null, codigo: '', nome: '', tipo: 'ambulatorio', ativo: true });
const motivo = ref('');
const dataSituacao = ref('');

// ── Setores ──
const tiposSetor = ['assistencial', 'apoio_diagnostico', 'apoio_tecnico', 'administrativo', 'logistico'];
const setor = ref<(Corpo & { ramais: Ramal[] }) | null>(null);
const novoSetor = () => ({
  id: null,
  codigo: '',
  nome: '',
  tipo: 'assistencial',
  superior: null,
  unidade: null,
  centroCusto: null,
  responsavel: null,
  responsavelNome: '',
  ramais: [] as Ramal[],
});
const editarSetor = (s: Setor) => (setor.value = { ...s, ramais: s.ramais.map((r) => ({ ...r })) });
const semCentroCusto = computed(
  () =>
    !!setor.value &&
    (setor.value['aceitaLancamentoConta'] === true || setor.value['producaoFaturada'] === true) &&
    !setor.value['centroCusto'],
);
const termo = ref('');
const achados = ref<Opcao[]>([]);
watch(termo, async (x) => {
  achados.value = x.trim().length >= 3 ? await buscarProfissionais(x.trim()).catch(() => []) : [];
});
function marcarUnico(campo: 'principal' | 'responsavel', i: number): void {
  if (!setor.value) return;
  setor.value.ramais.forEach((r, j) => {
    if (j !== i) r[campo] = false;
  });
}
/** Árvore: cada setor com o nível (recuo) pelo superior. */
const arvore = computed(() => {
  const s = dados.value?.setores ?? [];
  const filhos = (p: number | null): Setor[] => s.filter((x) => x.superior === p);
  const saida: { s: Setor; nivel: number }[] = [];
  const andar = (p: number | null, nivel: number, vistos: Set<number>) => {
    for (const x of filhos(p)) {
      if (vistos.has(x.id)) continue;
      vistos.add(x.id);
      saida.push({ s: x, nivel });
      andar(x.id, nivel + 1, vistos);
    }
  };
  const vistos = new Set<number>();
  andar(null, 0, vistos);
  for (const x of s) if (!vistos.has(x.id)) saida.push({ s: x, nivel: 0 });
  return saida;
});
const nomeUnidade = (id: number | null) =>
  dados.value?.unidades.find((u: Unidade) => u.id === id)?.nome ?? '—';
</script>

<template>
  <section class="tela" aria-labelledby="estrutura-gestao-titulo">
    <h1 id="estrutura-gestao-titulo">{{ t('estruturaGestao.estabelecimento.titulo') }}</h1>
    <div class="abas" role="tablist">
      <button
        v-for="a in ['estabelecimento', 'unidades', 'setores'] as const"
        :key="a"
        type="button"
        role="tab"
        :aria-selected="aba === a"
        :data-testid="`aba-${a}`"
        @click="aba = a"
      >
        {{ t(`estruturaGestao.abas.${a}`) }}
      </button>
    </div>
    <MensagemErro v-if="consulta.isError.value" :erro="consulta.error.value" />
    <MensagemErro v-if="erro" :erro="erro" />
    <p v-if="ok" role="status" data-testid="gravado">{{ t('estruturaGestao.comum.gravado') }}</p>
    <p v-if="consulta.isPending.value">{{ t('estruturaGestao.comum.carregando') }}</p>

    <template v-else-if="dados">
      <!-- Estabelecimento -->
      <form
        v-if="aba === 'estabelecimento'"
        class="grade"
        @submit.prevent="fazer(() => alterarEstabelecimento(est))"
      >
        <label v-for="c in CAMPOS_EST" :key="c">
          {{ t(`estruturaGestao.estabelecimento.${c}`) }}
          <input v-model="est[c] as string" :name="c" :aria-invalid="c === 'cnpj' && cnpjRuim" />
          <small v-if="c === 'cnpj' && cnpjRuim" class="aviso">{{
            t('estruturaGestao.estabelecimento.cnpjNaoConfere')
          }}</small>
        </label>
        <label v-for="c in ['tipo', 'porte', 'esfera'] as const" :key="c">
          {{ t(`estruturaGestao.estabelecimento.${c}`) }}
          <select v-model="est[c]" :name="c">
            <option :value="null">{{ t('estruturaGestao.comum.escolha') }}</option>
            <option
              v-for="o in dados.opcoes[c === 'tipo' ? 'tipos' : c === 'porte' ? 'portes' : 'esferas']"
              :key="o.id"
              :value="o.id"
            >
              {{ o.nome }}
            </option>
          </select>
        </label>
        <label v-for="c in ['inicioAtividade', 'fimAtividade'] as const" :key="c">
          {{ t(`estruturaGestao.estabelecimento.${c}`) }}
          <input v-model="est[c] as string" type="date" :name="c" />
        </label>
        <label class="marca"
          ><input v-model="est['hospitalDia']" type="checkbox" />
          {{ t('estruturaGestao.estabelecimento.hospitalDia') }}</label
        >
        <SanteBotao type="submit" :disabled="cnpjRuim" data-testid="gravar-estabelecimento">{{
          t('estruturaGestao.comum.gravar')
        }}</SanteBotao>
      </form>

      <!-- Unidades -->
      <div v-else-if="aba === 'unidades'">
        <SanteBotao data-testid="nova-unidade" @click="unidade = novaUnidade()">{{
          t('estruturaGestao.comum.novo')
        }}</SanteBotao>
        <table>
          <tbody>
            <tr v-for="u in dados.unidades" :key="u.id" :data-testid="`unidade-${u.codigo}`">
              <td>{{ u.codigo }}</td>
              <td>{{ u.nome }}</td>
              <td>{{ t(`estruturaGestao.unidade.tipos.${u.tipo}`) }}</td>
              <td>{{ u.ativo ? t('estruturaGestao.comum.ativo') : t('estruturaGestao.comum.inativo') }}</td>
              <td>
                <button type="button" @click="unidade = { ...u }">
                  {{ t('estruturaGestao.comum.editar') }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
        <form
          v-if="unidade"
          class="grade"
          @submit.prevent="
            fazer(
              () => gravarUnidade(unidade!['id'] as number | null, unidade!),
              () => (unidade = null),
            )
          "
        >
          <label
            v-for="c in [
              'codigo',
              'nome',
              'nomeCompleto',
              'sigla',
              'cnes',
              'cnpj',
              'cep',
              'telefone',
            ] as const"
            :key="c"
          >
            {{
              c in { codigo: 1, nome: 1, nomeCompleto: 1, sigla: 1 }
                ? t(`estruturaGestao.unidade.${c}`)
                : t(`estruturaGestao.estabelecimento.${c}`)
            }}
            <input v-model="unidade[c] as string" :name="`unidade-${c}`" />
          </label>
          <label>
            {{ t('estruturaGestao.unidade.tipo') }}
            <select v-model="unidade['tipo']" name="unidade-tipo">
              <option v-for="x in tiposUnidade" :key="x" :value="x">
                {{ t(`estruturaGestao.unidade.tipos.${x}`) }}
              </option>
            </select>
          </label>
          <label class="largo">
            {{ t('estruturaGestao.unidade.orientacaoAcesso') }}
            <textarea v-model="unidade['orientacaoAcesso'] as string" rows="2" />
          </label>
          <SanteBotao type="submit" data-testid="gravar-unidade">{{
            t('estruturaGestao.comum.gravar')
          }}</SanteBotao>
          <template v-if="unidade['id']">
            <label
              >{{ t('estruturaGestao.comum.motivo') }}<input v-model="motivo" name="motivo-unidade"
            /></label>
            <SanteBotao
              :disabled="motivo.trim().length < 10"
              @click="
                fazer(
                  () =>
                    situacaoUnidade(unidade!['id'] as number, {
                      versao: unidade!['versao'],
                      ativo: !unidade!['ativo'],
                      motivo,
                    }),
                  () => ((unidade = null), (motivo = '')),
                )
              "
            >
              {{
                unidade['ativo'] ? t('estruturaGestao.comum.inativar') : t('estruturaGestao.comum.reativar')
              }}
            </SanteBotao>
          </template>
        </form>
      </div>

      <!-- Setores -->
      <div v-else>
        <SanteBotao data-testid="novo-setor" @click="setor = novoSetor()">{{
          t('estruturaGestao.comum.novo')
        }}</SanteBotao>
        <ul class="arvore" data-testid="arvore-setores">
          <li
            v-for="{ s, nivel } in arvore"
            :key="s.id"
            :style="{ paddingLeft: `${nivel * 1.5}rem` }"
            :data-testid="`setor-${s.codigo}`"
          >
            <button type="button" class="link" @click="editarSetor(s)">{{ s.codigo }} — {{ s.nome }}</button>
            <span> · {{ t(`estruturaGestao.setor.tipos.${s.tipo}`) }} · {{ nomeUnidade(s.unidade) }}</span>
            <span v-if="s.ramalPrincipal">{{
              ` · ${t('estruturaGestao.setor.ramal')} ${s.ramalPrincipal}`
            }}</span>
            <span v-if="s.responsavelNome"> · {{ s.responsavelNome }}</span>
            <em v-if="!s.ativo"> · {{ t('estruturaGestao.comum.inativo') }} {{ s.dataInativacao }}</em>
          </li>
        </ul>
        <form
          v-if="setor"
          class="grade"
          @submit.prevent="
            fazer(
              () => gravarSetor(setor!['id'] as number | null, setor!),
              () => (setor = null),
            )
          "
        >
          <label v-for="c in ['codigo', 'nome', 'sigla'] as const" :key="c">
            {{ t(`estruturaGestao.setor.${c}`) }}<input v-model="setor[c] as string" :name="`setor-${c}`" />
          </label>
          <label>
            {{ t('estruturaGestao.setor.tipo') }}
            <select v-model="setor['tipo']" name="setor-tipo">
              <option v-for="x in tiposSetor" :key="x" :value="x">
                {{ t(`estruturaGestao.setor.tipos.${x}`) }}
              </option>
            </select>
          </label>
          <label>
            {{ t('estruturaGestao.setor.superior') }}
            <select v-model="setor['superior']" name="setor-superior">
              <option :value="null">—</option>
              <option
                v-for="x in dados.setores.filter((y) => y.id !== setor!['id'] && y.ativo)"
                :key="x.id"
                :value="x.id"
              >
                {{ x.nome }}
              </option>
            </select>
          </label>
          <label>
            {{ t('estruturaGestao.setor.unidade') }}
            <select v-model="setor['unidade']" name="setor-unidade">
              <option :value="null">—</option>
              <option v-for="x in dados.unidades.filter((y) => y.ativo)" :key="x.id" :value="x.id">
                {{ x.nome }}
              </option>
            </select>
          </label>
          <label>
            {{ t('estruturaGestao.setor.centroCusto') }}
            <select v-model="setor['centroCusto']" name="setor-centro-custo" :aria-invalid="semCentroCusto">
              <option :value="null">—</option>
              <option v-for="x in dados.opcoes.centrosCusto" :key="x.id" :value="x.id">{{ x.nome }}</option>
            </select>
            <small v-if="semCentroCusto" class="aviso">{{
              t('estruturaGestao.setor.precisaCentroCusto')
            }}</small>
          </label>
          <label>
            {{ t('estruturaGestao.setor.responsavel') }}
            <input
              v-model="termo"
              :placeholder="(setor['responsavelNome'] as string) || ''"
              name="setor-responsavel"
              list="setor-profissionais"
            />
            <select v-if="achados.length" v-model="setor['responsavel']" name="setor-responsavel-escolha">
              <option v-for="p in achados" :key="p.id" :value="p.id">{{ p.nome }}</option>
            </select>
          </label>
          <label v-for="c in ['responsavelInicio', 'responsavelFim'] as const" :key="c">
            {{ t(`estruturaGestao.setor.${c}`)
            }}<input v-model="setor[c] as string" type="date" :name="`setor-${c}`" />
          </label>
          <div
            v-if="((setor['responsaveis'] as Setor['responsaveis'] | undefined) ?? []).length"
            class="historico-responsaveis"
            data-testid="setor-historico-responsaveis"
          >
            <strong>{{ t('estruturaGestao.setor.historicoResponsaveis') }}</strong>
            <ul>
              <li v-for="r in setor['responsaveis'] as Setor['responsaveis']" :key="r.id">
                {{
                  t('estruturaGestao.setor.periodoResponsavel', {
                    nome: r.nome ?? String(r.profissional),
                    inicio: r.inicio,
                    fim: r.fim ?? t('estruturaGestao.setor.semFim'),
                  })
                }}
              </li>
            </ul>
          </div>
          <label
            v-for="c in [
              'podeSolicitarExames',
              'aceitaLancamentoConta',
              'producaoFaturada',
              'exigeProfissionalAgendamento',
              'exigeRecursoAgendamento',
            ] as const"
            :key="c"
            class="marca"
          >
            <input v-model="setor[c]" type="checkbox" :name="`setor-${c}`" />
            {{ t(`estruturaGestao.setor.${c}`) }}
          </label>
          <label v-for="c in ['siglaAgendamento', 'observacaoAgendamento'] as const" :key="c">
            {{ t(`estruturaGestao.setor.${c}`) }}<input v-model="setor[c] as string" :name="`setor-${c}`" />
          </label>
          <fieldset class="largo">
            <legend>{{ t('estruturaGestao.setor.ramais') }}</legend>
            <div v-for="(r, i) in setor.ramais" :key="i" class="ramal">
              <input
                v-model="r.ramal"
                :aria-label="t('estruturaGestao.setor.ramal')"
                inputmode="numeric"
                :name="`ramal-${i}`"
              />
              <input
                v-model="r.contato"
                :aria-label="t('estruturaGestao.setor.contato')"
                :placeholder="t('estruturaGestao.setor.contato')"
              />
              <input v-model="r.telefoneExterno" :placeholder="t('estruturaGestao.setor.telefoneExterno')" />
              <label class="marca"
                ><input
                  v-model="r.principal"
                  type="checkbox"
                  @change="r.principal && marcarUnico('principal', i)"
                />
                {{ t('estruturaGestao.setor.principal') }}</label
              >
              <label class="marca"
                ><input
                  v-model="r.responsavel"
                  type="checkbox"
                  @change="r.responsavel && marcarUnico('responsavel', i)"
                />
                {{ t('estruturaGestao.setor.doResponsavel') }}</label
              >
              <button type="button" @click="setor!.ramais.splice(i, 1)">
                {{ t('estruturaGestao.setor.retirar') }}
              </button>
            </div>
            <button
              type="button"
              data-testid="incluir-ramal"
              @click="
                setor!.ramais.push({
                  id: null,
                  ramal: '',
                  contato: null,
                  principal: setor!.ramais.length === 0,
                  responsavel: false,
                  telefoneExterno: null,
                  observacao: null,
                })
              "
            >
              {{ t('estruturaGestao.setor.incluirRamal') }}
            </button>
          </fieldset>
          <SanteBotao type="submit" :disabled="semCentroCusto" data-testid="gravar-setor">{{
            t('estruturaGestao.comum.gravar')
          }}</SanteBotao>
          <template v-if="setor['id']">
            <label
              >{{ t('estruturaGestao.comum.motivo') }}<input v-model="motivo" name="motivo-setor"
            /></label>
            <label v-if="setor['ativo']"
              >{{ t('estruturaGestao.comum.data') }}<input v-model="dataSituacao" type="date"
            /></label>
            <SanteBotao
              :disabled="motivo.trim().length < 10"
              data-testid="situacao-setor"
              @click="
                fazer(
                  () =>
                    situacaoSetor(setor!['id'] as number, {
                      versao: setor!['versao'],
                      ativo: !setor!['ativo'],
                      data: dataSituacao || null,
                      motivo,
                    }),
                  () => ((setor = null), (motivo = '')),
                )
              "
            >
              {{ setor['ativo'] ? t('estruturaGestao.comum.inativar') : t('estruturaGestao.comum.reativar') }}
            </SanteBotao>
          </template>
        </form>
      </div>
    </template>
  </section>
</template>

<style scoped>
.abas {
  display: flex;
  gap: var(--sgh-espaco-2);
  margin-bottom: var(--sgh-espaco-3);
}
.abas [aria-selected='true'] {
  font-weight: 700;
  border-bottom: 2px solid currentColor;
}
.grade {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(16rem, 1fr));
  gap: var(--sgh-espaco-2) var(--sgh-espaco-3);
  margin-top: var(--sgh-espaco-3);
}
.grade label {
  display: flex;
  flex-direction: column;
}
.grade .marca {
  flex-direction: row;
  align-items: center;
  gap: var(--sgh-espaco-1);
}
.largo {
  grid-column: 1 / -1;
}
.ramal {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  align-items: center;
}
.aviso {
  color: var(--sgh-cor-erro, #b00020);
}
.arvore {
  list-style: none;
  padding: 0;
}
.link {
  background: none;
  border: 0;
  text-decoration: underline;
  cursor: pointer;
}
</style>
